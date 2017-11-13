'use strict';

const fs = require('fs');
const extractZip = require('extract-zip');
const got = require('got');
const tmp = require('tmp');

const npmPackage = require('./package');
const config = require('./config');
const utils = require('./utils');

let versionsWithUnknownBranchingPoint = [];

function getOsCdnUrl() {
    let url = 'https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/';

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

function getExactChromeVersionNumber() {
    return new Promise((resolve, reject) => {
        const url = 'https://omahaproxy.appspot.com/history.json?channel=stable&os=' + getCurrentOs();
        const packageMajorVersion = npmPackage.version.split('.')[0];

        got(url)
            .then(response => {
                    let versions = JSON.parse(response.body);

                    for (let version of versions) {
                        let versionNumber = version['version'];
                        let buildMajorVersion = versionNumber.split('.')[0];

                        if (buildMajorVersion !== packageMajorVersion) {
                            continue;
                        }

                        if (versionsWithUnknownBranchingPoint.includes(versionNumber)) {
                            continue
                        }

                        resolve(versionNumber);
                    }
                }
            )
            .catch(err => {
                console.log('An error occured while trying to retrieve latest revision number', err);
                reject(err);
            });
    });
}

function getChromiumBranchingPoint(versionNumber) {
    return new Promise((resolve, reject) => {
        const url = 'https://omahaproxy.appspot.com/deps.json?version=' + versionNumber;

        got(url)
            .then(response => {
                let versionDetails = JSON.parse(response.body);
                let branchingPoint = parseInt(versionDetails['chromium_base_position']);

                if (!Number.isInteger(branchingPoint)) {
                    console.log('Could not find branching point for Chrome ' + versionNumber + '. This can happen when the new Chrome version is just branched off. Let\'s try to find the branching point for one version earlier.');
                    versionsWithUnknownBranchingPoint.push(versionNumber);

                    resolve(getExactChromeVersionNumber().then(getChromiumBranchingPoint));
                }

                console.log('Found that Chrome ' + versionNumber + ' was branched off Chromium at point ' + branchingPoint);

                resolve(branchingPoint);
            })
            .catch(err => {
                console.log('Could not get build details for version ' + versionNumber);
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
                console.log('Downloading Chromium build at branching point ' + revision + ' from Google CDN');
                const url = getOsCdnUrl() + `%2F${revision}%2F` + utils.getOsChromiumFolderName() + '.zip?alt=media';
                got.stream(url)
                    .on('error', () => {
                        console.log('Could not find a Chromium build for branching point ' + revision + '. Trying one point later.');
                        let nextRevision = revision + 1;

                        resolve(downloadChromiumRevision(nextRevision));
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

module.exports = getExactChromeVersionNumber()
    .then(getChromiumBranchingPoint)
    .then(downloadChromiumRevision)
    .then(path => unzipArchive(path, config.BIN_OUT_PATH))
    .catch(err => console.error('An error occurred while trying to setup Chromium. Resolve all issues and restart the process', err));

