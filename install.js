'use strict';

const fs = require('fs');
const extractZip = require('extract-zip');
const got = require('got');
const tmp = require('tmp');

const npmPackage = require('./package');
const config = require('./config');
const utils = require('./utils');

const CDN_URL = 'https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/';

function getOsCdnUrl() {
    let url = CDN_URL;

    const platform = process.platform;

    if (platform === 'linux') {
        url += 'Linux';
        if (process.arch === 'x64') {
            url += '_x64';
        }
    } else if (platform === 'win32') {
        url += 'Win';
        if (process.arch === 'x64') {
            url += '_x64';
        }
    } else if (platform === 'darwin') {
        url += 'Mac';
    } else {
        console.log('Unknown platform or architecture found:', process.platform, process.arch);
        throw new Error('Unsupported platform');
    }

    return url;
}

function getCurrentOs() {
    const platform = process.platform;

    if (platform === 'linux') {
        return 'linux';
    }

    if (platform === 'win32') {
        return 'win'
    }

    if (platform === 'darwin') {
        return 'mac';
    }

    console.log('Unknown platform found:', process.platform);
    throw new Error('Unsupported platform');
}

function getRevisionNumberForMajorVersion() {
    return new Promise((resolve, reject) => {
        const url = 'https://omahaproxy.appspot.com/all.json';
        const currentOs = getCurrentOs();
        const packageMajorVersion = npmPackage.version.split('.')[0];

        got(url)
            .then(response => {
                    let revisionNumber;
                    let platforms = JSON.parse(response.body);

                    for (let platform of platforms) {
                        if (platform['os'] !== currentOs) {
                            continue;
                        }

                        for (let version of platform['versions']) {
                            let buildMajorVersion = version['version'].split('.')[0];

                            if (buildMajorVersion !== packageMajorVersion) {
                                continue;
                            }

                            revisionNumber = version['branch_base_position'];
                            console.log('Found Chromium version ' + version['version'] + ' with build number ' + revisionNumber + '.');

                            resolve(revisionNumber);
                        }

                    }

                    if (!revisionNumber) {
                        console.error('Could not find a Chromium build with major version ' + packageMajorVersion + '. Only recent builds are available for download.');
                    }
                }
            )
            .catch(err => {
                console.log('An error occured while trying to retrieve latest revision number', err);
                reject(err);
            });
    });
}

function createTempFile() {
    return new Promise((resolve, reject) => {
        tmp.file((error, path) => {
            if (error) {
                console.log('An error occured while trying to create temporary file', error);
                reject(error);
            } else {
                resolve(path);
            }
        });
    });
}

function downloadChromiumRevision(revision) {
    return new Promise((resolve, reject) => {
        createTempFile()
            .then(path => {
                console.log('Downloading Chromium ' + revision + ' from Google CDN');
                const url = getOsCdnUrl() + `%2F${revision}%2F` + utils.getOsChromiumFolderName() + '.zip?alt=media';
                got.stream(url)
                    .on('error', error => {
                        console.log('An error occurred while trying to download Chromium archive', error);
                        reject(error);
                    })
                    .pipe(fs.createWriteStream(path))
                    .on('error', error => {
                        console.log('An error occurred while trying to save Chromium archive to disk', error);
                        reject(error);
                    })
                    .on('finish', () => {
                        resolve(path);
                    });
            });
    });
}

function unzipArchive(archivePath, outputFolder) {
    console.log('Started extracting archive', archivePath);
    return new Promise((resolve, reject) => {
        extractZip(archivePath, {dir: outputFolder}, error => {
            if (error) {
                console.log('An error occurred while trying to extract archive', error);
                reject(error);
            } else {
                console.log('Archive was successfully extracted');
                resolve(true);
            }
        });
    });
}

module.exports = getRevisionNumberForMajorVersion()
    .then(downloadChromiumRevision)
    .then(path => unzipArchive(path, config.BIN_OUT_PATH))
    .catch(err => console.error('An error occurred while trying to setup Chromium. Resolve all issues and restart the process', err));

