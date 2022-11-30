# Huge Uploader NodeJS Client

Based on the [https://github.com/Buzut/huge-uploader](huge-uploader) node module that is designed to handle file uploads in the browser. `huge-uploader-nodejs-client' can be used in NodeJS for transferring large files from 1 backend component to another.

`huge-uploader-nodejs-client` is a node module designed to handle huge file uploads by chunking them at the time of upload. Uploads are resumable, fault tolerent, offline aware and mobile ready.

HTTP and especially HTTP servers have limits and were not designed to transfer large files. In addition, network connection can be unreliable. No one wants an upload to fail after hours… Sometimes we even need to pause the upload, and HTTP doesn't allow that.

The best way to circumvent these issues is to chunk the file and send it in small pieces. If a chunk fails, no worries, it's small and fast to re-send it. Wanna pause? Ok, just start where you left off when ready.

That's what `huge-uploader` does. It:
* chunks the file in pieces of your chosen size,
* retries to upload a given chunk when transfer failed,
* auto pauses transfer when device is offline and resumes it when back online,
* allows you to pause and resume the upload,
* obviously allows you to set custom headers and post parameters.

## Installation & usage
```javascript
npm install huge-uploader-nodejs-client --save
```

```javascript
const HugeUploader = require('huge-uploader-nodejs-client');

// instantiate the module with a settings object
const uploader = new HugeUploader({ 
    endpoint: 'http://where-to-send-files.com/upload/',
    file: '/path/to/file.ext',
    postParams: { anyArgs: 'we want to send' }
});

// subscribe to events
uploader.on('error', (err) => {
    console.error('Something bad happened', err);
});

uploader.on('progress', (progress) => {
    console.log(`The upload is at ${progress}%`);
});

uploader.on('finish', () => {
    console.log('Upload finished!');
});

```

### Constructor settings object
The constructor takes a settings object. Available options are:
* `endpoint { String }` – where to send the chunks (__required__)
* `file { String }` – absolute path to the file to be uploaded (__required__)
* `headers { Object }` – custom headers to send with each request
* `postParams { Object }` – post parameters that __will be sent with the last chunk__
* `chunkSize { Number }` – size of each chunk in MB (default is 10MB)
* `verbose { Boolean}` - Enable verbose logging
* `chunkTimeout { Number }` - Optional timeout for each individual chunk upload (default is disabled)


#### `error`
Either server responds with an error code that isn't going to change.
Success response codes are `200`, `201`, `204`. All error codes apart from `408`, `502`, `503`, `504` are considered not susceptible to change with a retry.

Or there were too many retries already.
```javascript
uploader.on('error', err => console.log(err.detail)); // A string explaining the error
```

#### `progress`
```javascript
uploader.on('progress', progress => console.log(progress)); // Number between 0 and 100
```

#### `finish`

The finish event is triggered with the last response body attached.

```javascript
uploader.on('finish', () => console.log('🍾'));
```

## How to set up with the server
This module has a twin [Node.js module](https://github.com/Buzut/huge-uploader-nodejs) to handle uploads with a Node.js server as a backend. Neverthless it's easy to implement the server side in your preferred language (if you develop a module, tell me about it so I can add it to this README).


Files are sent with `POST` requests containing the following headers:
* `uploader-file-id` unique file id based on file size, upload time and a random generated number (so it's really unique),
* `uploader-chunks-total`the total numbers of chunk that will be sent,
* `uploader-chunk-number` the current chunk number (0 based index, so last chunk is `uploader-chunks-total - 1`).

`POST` parameters are sent with the last chunk if any (as set in constructor's options object).

The typical server implementation is to create a directory (name it after `uploader-file-id`) when chunk 0 is received and write all chunks into it. When last chunk is received, grab the `POST` parameters if any, concatenate all the files into a single file and remove the temporary directory.

Also, don't forget that you might never receive the last chunk if upload is abandoned, so don't forget to clean your upload directory from time to time.

In case you are sending to another domain or subdomain than the current site, you'll have to setup [`CORS`](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) accordingly. That is, set the following `CORS` headers:
* `Access-Control-Allow-Origin: https://origin-domain.com` (here you can set a wildcard or the domain from whitch you upload the file,
* `Access-Control-Allow-Methods: POST,OPTIONS`,
* `Access-Control-Allow-Headers: uploader-chunk-number,uploader-chunks-total,uploader-file-id`,
* `Access-Control-Max-Age: 86400`.

These parameters tell your browser that it can use `OPTIONS` (the [preflight request](https://developer.mozilla.org/en-US/docs/Glossary/Preflight_request)) and `POST` methods on the target domain and that the custom headers are allowed to be sent. The last header tells the browser than it can cache the result of the preflight request (here for 24hrs) so that it doesn't need to re-send a preflight before each `POST` request.

