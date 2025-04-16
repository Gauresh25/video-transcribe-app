const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3001;

// Configure AWS
AWS.config.update({
  accessKeyId: 'AKIAYUQGTCXVT2VNZYGH',
  secretAccessKey: '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',
  region: 'ap-south-1'
});

const s3 = new AWS.S3();
const transcribe = new AWS.TranscribeService();
const bucketName = 'connecttsec';

// Update your CORS configuration
app.use(cors({
  origin: '*',  // Allow all origins
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Set up temporary storage for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueFilename = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueFilename);
  },
});

const upload = multer({ storage });

// Enable CORS
app.use(cors());
app.use(express.json());

// Serve the static React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
}

// API route to upload a video file
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileName = req.file.filename;

    // Upload file to S3
    const fileContent = fs.readFileSync(filePath);
    const s3Params = {
      Bucket: bucketName,
      Key: `videos/${fileName}`,
      Body: fileContent,
      ContentType: req.file.mimetype
    };

    await s3.upload(s3Params).promise();

    // Clean up local file
    fs.unlinkSync(filePath);

    // Return success with the S3 key
    res.json({ key: `videos/${fileName}` });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// API route to start transcription
app.post('/api/transcribe', async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ error: 'No file key provided' });
    }

    // Create a unique job name
    const jobName = `transcription-${Date.now()}`;

    // Start transcription job
    const transcribeParams = {
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      Media: {
        MediaFileUri: `s3://${bucketName}/${key}`
      },
      OutputBucketName: bucketName,
      OutputKey: `transcripts/${jobName}-transcript.json`
    };

    await transcribe.startTranscriptionJob(transcribeParams).promise();

    res.json({ jobName });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

// API route to check transcription status
app.get('/api/transcribe/:jobName', async (req, res) => {
  try {
    const { jobName } = req.params;

    const result = await transcribe.getTranscriptionJob({
      TranscriptionJobName: jobName
    }).promise();

    if (result.TranscriptionJob.TranscriptionJobStatus === 'COMPLETED') {
      // Get the transcript JSON file
      const getParams = {
        Bucket: bucketName,
        Key: `transcripts/${jobName}-transcript.json`
      };

      const s3Data = await s3.getObject(getParams).promise();
      const transcriptJson = JSON.parse(s3Data.Body.toString());
      const plainText = transcriptJson.results.transcripts[0].transcript;

      // Store the plain text version
      const plainTextKey = `transcripts/${jobName}-transcript.txt`;
      await s3.putObject({
        Bucket: bucketName,
        Key: plainTextKey,
        Body: plainText,
        ContentType: 'text/plain'
      }).promise();

      res.json({
        status: 'COMPLETED',
        textKey: plainTextKey
      });
    } else {
      res.json({
        status: result.TranscriptionJob.TranscriptionJobStatus
      });
    }
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// API route to download transcript - FIXED
app.get('/api/download/:key(*)', async (req, res) => {  // Use (*) to match all characters including slashes
  try {
    const key = req.params.key;
    console.log(`Downloading from S3 with key: ${key}`);

    const getParams = {
      Bucket: bucketName,
      Key: key
    };

    try {
      const s3Data = await s3.getObject(getParams).promise();
      const transcript = s3Data.Body.toString();

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="transcript-${Date.now()}.txt"`);
      res.send(transcript);
    } catch (s3Error) {
      console.error('S3 error details:', s3Error);
      // If the error is because the file doesn't exist, provide a more helpful message
      if (s3Error.code === 'NoSuchKey') {
        return res.status(404).json({ 
          error: 'Transcript file not found',
          details: `The file '${key}' was not found in the S3 bucket.`,
          suggestion: 'Check if the file path is correct and the transcription job has completed.'
        });
      }
      throw s3Error;
    }
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed', details: error.message });
  }
});

// Add a diagnostic endpoint to check if files exist
app.get('/api/check-file/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    console.log(`Checking if file exists: ${key}`);

    try {
      await s3.headObject({
        Bucket: bucketName,
        Key: key
      }).promise();
      
      res.json({ exists: true, key: key });
    } catch (headError) {
      if (headError.code === 'NotFound') {
        res.json({ exists: false, key: key });
      } else {
        throw headError;
      }
    }
  } catch (error) {
    console.error('File check error:', error);
    res.status(500).json({ error: 'File check failed', details: error.message });
  }
});

// Catch-all route to serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  console.log(`Access at http://YOUR_PUBLIC_IP:${port}`);
});
