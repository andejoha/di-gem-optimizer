/**
 * URLs for files in `public/` that can't go through Vite's asset pipeline as
 * module imports (favicon, files referenced by more than one component) —
 * resolved against the configured base path so they still work when the app
 * is served from a subpath.
 */
export const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`;
