const express = require('express');
const path = require('path');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const { getDb } = require('./db/connection');
const config = require('./config');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Sessions (SQLite-backed)
app.use(session({
  store: new SqliteStore({ client: getDb(), expired: { clear: true, intervalMs: 900000 } }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// Make user available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.currentPath = req.path;
  delete req.session.flash;
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/onboarding'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/settings'));
app.use('/', require('./routes/students'));
app.use('/auth/google', require('./routes/google'));
app.use('/api', require('./routes/api'));

module.exports = app;
