import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './checkout.css';
import './owner-studio.css';
import './styles.css';
import './mobile-navigation.css';
import './image-management.css';
import './banners.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);