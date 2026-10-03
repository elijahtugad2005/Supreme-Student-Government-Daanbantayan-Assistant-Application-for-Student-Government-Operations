import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { CardProvider } from './CardContext/CardContext.jsx'; // ✅ import this
import { connectToEmulators, usingEmulators, emulatorServices } from './firebase/emulators.js';

// Must run before anything calls Firebase, or the first request goes to
// production and the AI callables 404 until they are deployed.
if (usingEmulators()) {
  connectToEmulators();
  console.info(
    `[firebase] Emulator mode: ${emulatorServices().join(', ')}. ` +
      'Auth stays on the real project, so Google sign-in still works.'
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      {/* ✅ Wrap App in CardProvider */}
      <CardProvider>
        <App />
      </CardProvider>
    </HashRouter>
  </StrictMode>
);
