// The server sent the prerendered landing page (src/web/app.py), which it
// only does when the request has no valid session.
export const prerenderedLanding = document.getElementById('root')?.dataset.prerendered === 'landing';
