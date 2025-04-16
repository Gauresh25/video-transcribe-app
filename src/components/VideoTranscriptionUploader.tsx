import { useState, useRef, ChangeEvent } from 'react';
import { FiUpload, FiDownload, FiCheck, FiAlertCircle } from 'react-icons/fi';
import axios from 'axios';
import './VideoTranscriptionUploader.css';

// API URL - change this to your server URL
const API_URL = 'http://15.207.109.220:3001/api';

enum Status {
  IDLE = 'idle',
  UPLOADING = 'uploading',
  TRANSCRIBING = 'transcribing',
  COMPLETE = 'complete',
  ERROR = 'error'
}

const VideoTranscriptionUploader = () => {
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState<Status>(Status.IDLE);
  const [error, setError] = useState('');
  const [transcriptKey, setTranscriptKey] = useState('');
  const [jobName, setJobName] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    
    if (!selectedFile.type.startsWith('video/')) {
      setError('Please select a valid video file');
      setStatus(Status.ERROR);
      return;
    }
    
    setFile(selectedFile);
    setError('');
    uploadFile(selectedFile);
  };

  const uploadFile = async (videoFile: File) => {
    try {
      setStatus(Status.UPLOADING);
      setUploadProgress(0);
      
      // Create form data for upload
      const formData = new FormData();
      formData.append('video', videoFile);
      
      // Upload file to backend
      const response = await axios.post(`${API_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentage = Math.round(
            (progressEvent.loaded * 100) / (progressEvent.total || 1)
          );
          setUploadProgress(percentage);
        },
      });
      
      // Start transcription job
      startTranscriptionJob(response.data.key);
    } catch (err) {
      console.error('Upload error:', err);
      setError('File upload failed. Please try again.');
      setStatus(Status.ERROR);
    }
  };

  const startTranscriptionJob = async (fileKey: string) => {
    try {
      setStatus(Status.TRANSCRIBING);
      
      // Start transcription job via backend API
      const response = await axios.post(`${API_URL}/transcribe`, { key: fileKey });
      
      // Store job name for polling
      setJobName(response.data.jobName);
      
      // Start polling for job completion
      pollTranscriptionStatus(response.data.jobName);
    } catch (err) {
      console.error('Transcription error:', err);
      setError('Transcription failed. Please try again.');
      setStatus(Status.ERROR);
    }
  };

  const pollTranscriptionStatus = async (name: string) => {
    try {
      const response = await axios.get(`${API_URL}/transcribe/${name}`);
      
      if (response.data.status === 'COMPLETED') {
        setTranscriptKey(response.data.textKey);
        setStatus(Status.COMPLETE);
      } else if (response.data.status === 'FAILED') {
        throw new Error('Transcription job failed');
      } else {
        // Job still in progress, poll again after delay
        setTimeout(() => pollTranscriptionStatus(name), 5000);
      }
    } catch (err) {
      console.error('Polling error:', err);
      setError('Failed to get transcription status.');
      setStatus(Status.ERROR);
    }
  };

  const handleDownload = async () => {
    try {
      // Direct the browser to the download URL
      window.location.href = `${API_URL}/download/${transcriptKey}`;
    } catch (err) {
      console.error('Download error:', err);
      setError('Failed to download transcription.');
    }
  };

  const resetForm = () => {
    setFile(null);
    setStatus(Status.IDLE);
    setError('');
    setUploadProgress(0);
    setTranscriptKey('');
    setJobName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="transcription-uploader">
      {error && (
        <div className="error-message">
          <FiAlertCircle />
          <p>{error}</p>
        </div>
      )}

      {status === Status.IDLE && (
        <div className="upload-area">
          <div 
            className="upload-zone"
            onClick={() => fileInputRef.current?.click()}
          >
            <FiUpload className="upload-icon" />
            <p>Select a video file to transcribe</p>
            <span>Click here or drag and drop</span>
            <input
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              ref={fileInputRef}
              className="hidden-input"
            />
          </div>
        </div>
      )}

      {status === Status.UPLOADING && (
        <div className="progress-container">
          <h3>Uploading {file?.name}</h3>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${uploadProgress}%` }}
            ></div>
          </div>
          <p className="progress-text">{uploadProgress}%</p>
        </div>
      )}

      {status === Status.TRANSCRIBING && (
        <div className="processing-container">
          <div className="spinner"></div>
          <h3>Generating transcription...</h3>
          <p>This may take a few minutes</p>
        </div>
      )}

      {status === Status.COMPLETE && (
        <div className="complete-container">
          <div className="success-icon">
            <FiCheck />
          </div>
          <h3>Transcription complete!</h3>
          <button onClick={handleDownload} className="download-button">
            <FiDownload />
            Download Transcription
          </button>
          <button onClick={resetForm} className="reset-button">
            Transcribe another video
          </button>
        </div>
      )}

      {status === Status.ERROR && (
        <div className="error-container">
          <button onClick={resetForm} className="reset-button">
            Try again
          </button>
        </div>
      )}
    </div>
  );
};

export default VideoTranscriptionUploader;
