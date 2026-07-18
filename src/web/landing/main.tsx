import React from 'react';
import { createRoot } from 'react-dom/client';
import { LandingPage } from './LandingPage';
import './landing.css';

createRoot(document.getElementById('landing-root') as HTMLElement).render(
  <React.StrictMode>
    <LandingPage />
  </React.StrictMode>
);
