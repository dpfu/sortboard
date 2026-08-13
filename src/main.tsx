import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MotionPreferences } from './MotionPreferences';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionPreferences>
      <App />
    </MotionPreferences>
  </React.StrictMode>
);
