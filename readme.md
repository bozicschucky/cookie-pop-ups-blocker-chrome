## Cookie Pop ups and sign in/up forms blocker

### About
A simple script that blocks cookie pop ups and sign in/up forms that are mandatory on certain websites. This extension is fast and efficient since its minimal and has no dependencies on any libraries.

### Features
- Block mandatory cookie pop ups
- Block mandatory sign in/up forms
- Adaptive detection algorithms with configurable strength levels
- Site-specific learning system that improves detection over time
- Automatic scroll fixes when overlays lock the page
- Element position detection for common cookie banner patterns
- Visual counter showing blocked items

### Advanced Settings
- **Detection Strength**: Choose between Low, Medium, and High detection sensitivity
- **Adaptive Learning**: Enable/disable the learning system that improves detection on frequently visited sites
- **Site-specific Patterns**: Reset learned patterns for individual domains

### How to use
Once installed, the extension will automatically detect and remove cookie banners and sign-up forms. A counter in the popup shows how many elements have been blocked. You can:

- Click on the extension icon to see how many popups have been blocked
- Adjust detection strength based on your preference
- Temporarily disable the extension for specific websites
- Reset learned patterns if detection becomes too aggressive

### How to install locally
- Clone the repository
- Enable the dev tools for the chrome extensions page
- Load the extension in the chrome browser from the code cloned
- Click on the extension icon

### Technologies used
- JavaScript (ES6) with no dependencies
- CSS3
- Chrome Extension API

### License
MIT License