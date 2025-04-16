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

// Function to check and set up proper bucket permissions for Transcribe
async function setupBucketPermissionsForTranscribe() {
  try {
    console.log('Setting up S3 bucket permissions for Transcribe service...');
    
    // This policy grants the Transcribe service permission to read from the bucket
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'TranscribeAccess',
          Effect: 'Allow',
          Principal: {
            Service: 'transcribe.amazonaws.com'
          },
          Action: [
            's3:GetObject',
            's3:ListBucket'
          ],
          Resource: [
            `arn:aws:s3:::${bucketName}`,
            `arn:aws:s3:::${bucketName}/*`
          ]
        }
      ]
    };

    // Apply the bucket policy
    await s3.putBucketPolicy({
      Bucket: bucketName,
      Policy: JSON.stringify(bucketPolicy)
    }).promise();
    
    console.log('Successfully updated bucket policy for Transcribe access');
  } catch (error) {
    console.error('Failed to update bucket policy:', error);
    // Continue anyway - it might work if permissions are already set up correctly
  }
}

// Call the setup function when the server starts
setupBucketPermissionsForTranscribe();

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
app.use(cors({
  origin: '*',  // Allow all origins
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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
    
    console.log(`Processing uploaded file: ${fileName}`);

    // Upload file to S3
    const fileContent = fs.readFileSync(filePath);
    const s3Key = `videos/${fileName}`;
    const s3Params = {
      Bucket: bucketName,
      Key: s3Key,
      Body: fileContent,
      ContentType: req.file.mimetype,
      ACL: 'bucket-owner-full-control'  // Ensure bucket owner has control
    };

    console.log(`Uploading to S3: ${s3Key}`);
    await s3.upload(s3Params).promise();
    console.log('Upload to S3 successful');

    // Clean up local file
    fs.unlinkSync(filePath);

    // Return success with the S3 key
    res.json({ key: s3Key });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
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
    console.log(`Starting transcription job: ${jobName} for file ${key}`);

    // Check if file exists before starting transcription
    try {
      await s3.headObject({
        Bucket: bucketName,
        Key: key
      }).promise();
      console.log(`Confirmed file exists: s3://${bucketName}/${key}`);
    } catch (headError) {
      console.error('File does not exist in S3:', headError);
      return res.status(404).json({ 
        error: 'File not found in S3', 
        details: `The file '${key}' could not be found in the bucket.`
      });
    }

    // Set the S3 URI for the media file
    const mediaFileUri = `s3://${bucketName}/${key}`;
    console.log(`Media URI for transcription: ${mediaFileUri}`);

    // Start transcription job
    const transcribeParams = {
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      Media: {
        MediaFileUri: mediaFileUri
      },
      OutputBucketName: bucketName,
      OutputKey: `transcripts/${jobName}-transcript.json`
    };

    await transcribe.startTranscriptionJob(transcribeParams).promise();
    console.log('Transcription job started successfully');

    res.json({ jobName });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ 
      error: 'Transcription failed', 
      details: error.message,
      code: error.code 
    });
  }
});

// API route to check transcription status
app.get('/api/transcribe/:jobName', async (req, res) => {
  try {
    const { jobName } = req.params;
    console.log(`Checking status of transcription job: ${jobName}`);

    const result = await transcribe.getTranscriptionJob({
      TranscriptionJobName: jobName
    }).promise();

    const status = result.TranscriptionJob.TranscriptionJobStatus;
    console.log(`Job status: ${status}`);

    if (status === 'COMPLETED') {
      // Get the transcript JSON file
      const jsonKey = `transcripts/${jobName}-transcript.json`;
      console.log(`Fetching completed transcript from: ${jsonKey}`);
      
      try {
        const s3Data = await s3.getObject({
          Bucket: bucketName,
          Key: jsonKey
        }).promise();
        
        const transcriptJson = JSON.parse(s3Data.Body.toString());
        const plainText = transcriptJson.results.transcripts[0].transcript;

        // Store the plain text version
        const plainTextKey = `transcripts/${jobName}-transcript.txt`;
        console.log(`Storing plain text transcript at: ${plainTextKey}`);
        
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
      } catch (s3Error) {
        console.error('Error retrieving transcript JSON:', s3Error);
        res.status(500).json({ 
          error: 'Failed to retrieve transcript', 
          details: s3Error.message 
        });
      }
    } else if (status === 'FAILED') {
      const failureReason = result.TranscriptionJob.FailureReason;
      console.error(`Transcription job failed: ${failureReason}`);
      res.json({
        status: 'FAILED',
        reason: failureReason
      });
    } else {
      // Job still in progress
      res.json({
        status: status
      });
    }
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check status', details: error.message });
  }
});

// API route to download transcript
app.get('/api/download/:key(*)', async (req, res) => {
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
      if (s3Error.code === 'NoSuchKey') {
        return res.status(404).json({ 
          error: 'Transcript file not found',
          details: `The file '${key}' was not found in the S3 bucket.`
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

// Serve frontend in production
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  console.log(`Access locally at http://localhost:${port}`);
  console.log(`For remote access, use your server's public IP: http://YOUR_PUBLIC_IP:${port}`);
});