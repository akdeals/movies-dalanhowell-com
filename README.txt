MOVIE NIGHT WHEEL
=================

This package is ready for movies.dalanhowell.com on InfinityFree-style PHP hosting.

UPLOAD
------
1. Create the movies.dalanhowell.com subdomain in your hosting dashboard.
2. In File Manager, open movies.dalanhowell.com/htdocs.
3. Remove the placeholder index.html if one already exists.
4. Upload the CONTENTS of this package into that htdocs folder. Keep the data
   folder and its files together.
5. Visit https://movies.dalanhowell.com.

If the page loads but reports a server error, verify that the data folder and
data/state.json are writable by PHP. Normal hosting permissions are usually
755 for the data folder and 644 or 664 for state.json. Avoid 777 permissions.

HOW SYNCHRONIZATION WORKS
------------------------
- api.php is the shared source of truth.
- A spin is chosen securely on the server and saved in data/state.json.
- Every browser checks the server once per second.
- The server supplies a shared start time, duration, result, and final angle,
  so everyone sees the same spin even if they open the page partway through.
- File locking prevents two simultaneous clicks from creating conflicting spins.

EDITING THE MOVIE LIST
----------------------
Edit movies.csv and keep the first row as:

title

Put one movie title on each row. Make changes while the wheel is not spinning.
The site will automatically reload the updated list within about one second.

FILES
-----
index.html       Page structure
styles.css       Visual design and responsive layout
app.js           Wheel drawing, animation, polling, and synchronized UI
api.php          Shared spin API and CSV reader
movies.csv       Movie choices extracted from the supplied image
data/state.json  Current shared spin state
data/.htaccess   Prevents direct access to shared state
