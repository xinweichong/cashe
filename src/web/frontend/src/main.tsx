import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTextSize, readTextSize } from './lib/textSize';

// Before first paint, so the saved text size never flashes in at default.
applyTextSize(readTextSize());

// iOS Safari zooms into any focused field under 16px, which the Small text
// size produces. maximum-scale stops that focus zoom without blocking pinch
// zoom (iOS ignores it for pinch), so fields can follow the text size. It is
// iOS-only because Android does honour it for pinch.
if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', `${viewport.getAttribute('content')}, maximum-scale=1`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
