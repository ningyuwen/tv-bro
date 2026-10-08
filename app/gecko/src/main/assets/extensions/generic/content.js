// This is a leftover from the removal of the abandoned "text selection" feature.
// I'll leave it here for now as a framework for future extension-based features.

console.log("TV Bro generic content extension loaded");

window.addEventListener('load', function () {
    //document.body.style.userSelect = "none";
    console.log("window.load executed");
});

const communicatePort = browser.runtime.connectNative("tvbro_content");

communicatePort.onMessage.addListener(message => {
    if (message.action === 'remoteScroll' && window === window.top) {
        limeRemoteScroll(message.x, message.y, message.dx, message.dy, message.gestureId, message.deadline);
    }
});
