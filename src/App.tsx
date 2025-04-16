import { useState } from 'react';
import VideoTranscriptionUploader from './components/VideoTranscriptionUploader';
import './App.css';

function App() {
  return (
    <div className="app-container">
      <header>
        <h1>Video Transcription Tool</h1>
        <p>Upload a video and get your transcription</p>
      </header>
      
      <main>
        <VideoTranscriptionUploader />
      </main>
      
      <footer>
        <p>Simple AWS Transcribe Demo</p>
      </footer>
    </div>
  );
}

export default App;