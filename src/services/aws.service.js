const AWS = require('aws-sdk');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');

// Configure AWS
AWS.config.update({
    region: config.aws.region,
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey
});

const s3 = new AWS.S3();

/**
 * Upload a file to AWS S3
 * @param {Object} file - The file object from multer
 * @param {string} folder - The folder name in S3 bucket
 * @returns {Promise<string>} The URL of the uploaded file
 */
const uploadFile = async (file, folder = '') => {
    if (!file) {
        throw new Error('No file provided');
    }

    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${uuidv4()}.${fileExtension}`;

    const params = {
        Bucket: config.aws.s3Bucket,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
    };

    try {
        const result = await s3.upload(params).promise();
        return result.Location;
    } catch (error) {
        console.error('Error uploading file to S3:', error);
        throw new Error('Failed to upload file to S3');
    }
};

/**
 * Delete a file from AWS S3
 * @param {string} fileUrl - The URL of the file to delete
 * @returns {Promise<void>}
 */
const deleteFile = async (fileUrl) => {
    if (!fileUrl) {
        return;
    }

    // Extract the key from the URL
    const key = fileUrl.split(`${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/`)[1];
    if (!key) {
        console.warn('Invalid S3 URL format');
        return;
    }

    const params = {
        Bucket: config.aws.s3Bucket,
        Key: key
    };

    try {
        await s3.deleteObject(params).promise();
    } catch (error) {
        console.error('Error deleting file from S3:', error);
        throw new Error('Failed to delete file from S3');
    }
};

module.exports = {
    uploadFile,
    deleteFile
};
