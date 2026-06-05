// App-level configuration that isn't sensitive but does vary per deployment.

// Google "Continue with Google" OAuth 2.0 Web client ID, from the Google Cloud
// console (APIs & Services → Credentials). Leave empty to disable the feature —
// the Google button hides itself and the API reports it as not configured.
// The SAME value must be set on the backend as the GOOGLE_CLIENT_ID env var, and
// your site's origin must be added to the client's "Authorized JavaScript origins".
export const GOOGLE_CLIENT_ID = '157170037006-2t5ccmun0rl5ua9g05ggg1q9tv00j45f.apps.googleusercontent.com';
