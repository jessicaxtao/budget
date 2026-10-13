import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import AppProviders from './contexts/AppProviders';
import { AuthProvider } from './contexts/AuthContext';
import { BooksKeyProvider } from './contexts/BooksKeyContext';
import { SyncProvider } from './contexts/SyncContext';
import AuthGate from './components/AuthGate';
import BooksKeyGate from './components/BooksKeyGate';
import ImportBooksGate from './components/ImportBooksGate';
import { routerFuture } from './routerFuture';

// Five layers outside the stores, and the order is the order the questions have
// to be answered in:
//
//   AuthProvider    — who is asking. Nothing below can be decided without it.
//   AuthGate        — renders the way in instead of the app when there is no
//                     answer yet, so nothing below ever runs signed out.
//   BooksKeyGate    — the books password, set up or unlocked, before anything
//                     below reaches for the documents it seals. It sits above
//                     SyncProvider because SyncContext reads the key through
//                     booksKey.js's module state and needs it set before it
//                     hydrates — the key has to exist before there is
//                     anything to decrypt.
//   SyncProvider    — decrypts that account's documents into the local cache
//                     and **holds the render** until they are there. This is the
//                     load-bearing one: four store initialisers read storage
//                     synchronously to build their lazy defaults, and they must
//                     find the right household's books when they do.
//   ImportBooksGate — the one-time offer to carry this browser's pre-account
//                     books up into an empty account.
//
// AppProviders is unchanged underneath all of it, which was the point — see
// src/hooks/useSyncedState.js.

// A household to look at on the dev server, written before the first render
// because the store initialisers read storage synchronously. `require` inside a
// constant condition rather than a top-level import, so webpack folds the branch
// and drops the module from a production build entirely — see src/devSeed.js,
// which also explains why it only ever writes local mode's own books.
if (process.env.NODE_ENV === 'development') {
  // eslint-disable-next-line global-require
  require('./devSeed').installDemoBooks();
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <BooksKeyProvider>
          <BooksKeyGate>
            <SyncProvider>
              <ImportBooksGate>
                <AppProviders>
                  <BrowserRouter future={routerFuture}>
                    <App />
                  </BrowserRouter>
                </AppProviders>
              </ImportBooksGate>
            </SyncProvider>
          </BooksKeyGate>
        </BooksKeyProvider>
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
