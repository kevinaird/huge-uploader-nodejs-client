'use strict';

const EventEmitter = require('events');
const fs = require("fs");
const FormData = require("form-data");
const fetch = require("./fetchTimeout");

class HugeUploaderNodeClient {

    constructor(params) {
        this.endpoint = params.endpoint;
        this.file = params.file;
        this.headers = params.headers || {};
        this.postParams = params.postParams;
        this.chunkSize = params.chunkSize || 10;
        this.chunkSizeBytes = this.chunkSize * 1024 * 1024;
        this.retries = params.retries || 5;
        this.delayBeforeRetry = params.delayBeforeRetry || 5;
        this.verbose = !!params.verbose;
        this.chunkTimeout = params.chunkTimeout || (60 * 60 * 1000);

        this.start = 0;
        this.chunk = Buffer.alloc(this.chunkSizeBytes);
        this.chunkCount = 0;
        this.retriesCount = 0;

        this._eventTarget = new EventEmitter();

        this._validateParams();

        const stats = require("fs").statSync(this.file);
        this.fileSize = stats.size;
        this.totalChunks = Math.ceil(this.fileSize / this.chunkSizeBytes);

        this.headers['uploader-file-id'] = this._uniqid();
        this.headers['uploader-chunks-total'] = this.totalChunks;

        this._startSending();
    }

    /**
     * Custom logger
     */
    log() {
        if(!this.verbose) return;
        const args = Array.from(arguments);
        console.log.apply(this,args);
    }

    /**
     * Subscribe to an event
     */
     on(eType, fn) {
        this._eventTarget.on(eType, fn);
    }

    /**
     * Validate params and throw error if not of the right type
     */
    _validateParams() {
        if (!this.endpoint || !this.endpoint.length) throw new TypeError('endpoint must be defined');
        if (typeof this.file !== 'string') throw new TypeError('file must be a string');
        if (this.headers && typeof this.headers !== 'object') throw new TypeError('headers must be null or an object');
        if (this.postParams && typeof this.postParams !== 'object') throw new TypeError('postParams must be null or an object');
        if (this.chunkSize && (typeof this.chunkSize !== 'number' || this.chunkSize === 0)) throw new TypeError('chunkSize must be a positive number');
        if (this.retries && (typeof this.retries !== 'number' || this.retries === 0)) throw new TypeError('retries must be a positive number');
        if (this.delayBeforeRetry && (typeof this.delayBeforeRetry !== 'number')) throw new TypeError('delayBeforeRetry must be a positive number');
    }

    /**
     * Generate uniqid based on file size, date & pseudo random number generation
     */
    _uniqid() {
        return Math.floor(Math.random() * 100000000) + Date.now() + this.fileSize;
    }

    /**
     * Get portion of the file of x bytes corresponding to chunkSize
     */
    async _getChunk() {
        const nread = await new Promise((resolve,reject)=> {
            this.log("reading fd",this.fd,"for chunk",this.chunkCount);
            fs.read(this.fd,this.chunk,0,this.chunkSizeBytes,null,(err,nread)=>{
                if(err) return reject(err);
                return resolve(nread);
            })
        });

        if(nread===0) {
            this.log("closing fd",this.fd,"after chunk",this.chunkCount,"total chunk=",this.totalChunks);
            await new Promise((resolve,reject)=>fs.close(this.fd,err=>{
                if(err) return reject(err);
                return resolve();
            }));
            return;
        }

        this.log("read",nread,"bytes for",this.fd,"for chunk",this.chunkCount);

        if(nread<this.chunkSizeBytes)
            return { data: this.chunk.slice(0,nread), lastChunk: true };
        else
            return { data: this.chunk, lastChunk: false };
    }

    /**
     * Send chunk of the file with appropriate headers and add post parameters if it's last chunk
     */
    _sendChunk({ data, lastChunk }) {
        this.log("sending chunk",this.chunkCount,"lastChunk=",lastChunk);
        const form = new FormData();

        // send post fields on last request
        if (lastChunk) Object.keys(this.postParams).forEach(key => form.append(key, this.postParams[key]));

        form.append('file', data,{contentType:"application/octet-stream"});
        this.headers['uploader-chunk-number'] = this.chunkCount;

        return fetch(this.endpoint, { method: 'POST', headers: this.headers, body: form, timeout: this.chunkTimeout });
    }

    /**
     * Called on net failure. If retry counter !== 0, retry after delayBeforeRetry
     */
    _manageRetries() {
        if (this.retriesCount++ < this.retries) {
            setTimeout(() => this._sendChunks(), this.delayBeforeRetry * 1000);
            this._eventTarget.emit('fileRetry', { 
                message: `An error occured uploading chunk ${this.chunkCount}. ${this.retries - this.retriesCount} retries left`, 
                chunk: this.chunkCount, 
                retriesLeft: this.retries - this.retriesCount 
            });
            return;
        }

        this._eventTarget.emit('error', `An error occured uploading chunk ${this.chunkCount}. No more retries, stopping upload`);
    }

    /**
     * Manage the whole upload by calling getChunk & sendChunk
     * handle errors & retries and dispatch events
     */
    _sendChunks() {
        return this._getChunk()
        .then((out) => this._sendChunk(out))
        .then((res) => { 
            this.log("huge uploader res.status",res.status);
            if (res.status === 200 || res.status === 201 || res.status === 204) {
                if (++this.chunkCount < this.totalChunks) this._sendChunks();
                else this._eventTarget.emit('finish');

                const percentProgress = Math.round((100 / this.totalChunks) * this.chunkCount);
                this._eventTarget.emit('progress', percentProgress);
            }

            // errors that might be temporary, wait a bit then retry
            else if ([408, 502, 503, 504].includes(res.status)) {
                this._manageRetries();
            }

            else {
                this._eventTarget.emit('error', `Server responded with ${res.status}. Stopping upload`);
            }
        })
        .catch((err) => { 
            this.log("huge uploader err",err);

            // this type of error can happen after network disconnection on CORS setup
            this._manageRetries();
        });
    }

    /**
     * Start sending chunks
     */
    _startSending() {
        new Promise((resolve,reject)=>{
            fs.open(this.file,'r',(err,fd)=>{
                if(err) return reject(err);
                this.fd = fd;
                this.log("opened fd",fd);
                return resolve();
            });
        })
        .then(()=>this._sendChunks())
        .catch((err)=>{
            this.log("huge uploader start err",err);
            this._eventTarget.emit('error', 'Failed starting to sending chunks');
        });
    }

}

module.exports = HugeUploaderNodeClient;