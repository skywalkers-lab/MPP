(function () {
  'use strict';

  var RELEASE_CONFIG = {
    owner: 'skywalkers-lab',
    repo: 'MPP',
    version: 'v0.1.18',
    desktopAsset: 'MPP-Desktop.exe',
    portableAsset: 'MPP-portable.exe',
  };

  function latestReleaseUrl() {
    return 'https://github.com/' + RELEASE_CONFIG.owner + '/' + RELEASE_CONFIG.repo + '/releases/latest';
  }

  function latestAssetUrl(assetName) {
    return latestReleaseUrl() + '/download/' + encodeURIComponent(assetName);
  }

  function setText(id, text) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = text;
  }

  function setHref(id, href) {
    var node = document.getElementById(id);
    if (!node) return;
    node.setAttribute('href', href);
  }

  function init() {
    var releaseUrl = latestReleaseUrl();
    var repoUrl = 'https://github.com/' + RELEASE_CONFIG.owner + '/' + RELEASE_CONFIG.repo;

    setText('current-version', RELEASE_CONFIG.version);

    setHref('download-installer', latestAssetUrl(RELEASE_CONFIG.desktopAsset));
    setHref('download-portable', latestAssetUrl(RELEASE_CONFIG.portableAsset));

    setHref('latest-release-link', releaseUrl);
    setHref('release-notes-link', releaseUrl);
    setHref('release-notes-link-2', releaseUrl);
    setHref('all-releases-link', 'https://github.com/' + RELEASE_CONFIG.owner + '/' + RELEASE_CONFIG.repo + '/releases');
    setHref('repo-link', repoUrl);
  }

  init();
})();
