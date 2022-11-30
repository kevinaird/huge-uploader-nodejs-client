module.exports = {
    input: 'src/index.js',
    output: {
        format: 'cjs',
        file: 'lib/index.js'
    },
    external: [
        'node-fetch',
        'form-data'
    ]
};
