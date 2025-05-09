// IMPORTANT: firebaseConfig should be defined in your HTML file's inline <script> tag
// BEFORE this app.js script is loaded.
// This app.js file will USE that globally available firebaseConfig object.
// DO NOT re-declare 'const firebaseConfig = { ... };' here.

// Initialize Firebase
// It's assumed firebaseConfig is globally available from your HTML's inline script.
let firebaseApp;
let auth;
let db;

try {
    // Check if the global 'firebase' object (from SDK) and 'firebaseConfig' (from your HTML) exist
    if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
        if (!firebase.apps.length) { // Check if Firebase hasn't been initialized yet
            firebaseApp = firebase.initializeApp(firebaseConfig); // Uses the firebaseConfig from your HTML
            console.log("Firebase Initialized (from app.js using HTML's firebaseConfig)");
        } else {
            firebaseApp = firebase.app(); // Get the default app if already initialized
            console.log("Firebase already initialized, using existing app (from app.js).");
        }
        auth = firebase.auth(); // Firebase Authentication service
        db = firebase.firestore(); // Firestore Database service
    } else {
        if (typeof firebase === 'undefined') {
            console.error("Firebase SDK not loaded before app.js tried to initialize Firebase.");
        }
        if (typeof firebaseConfig === 'undefined') {
            console.error("firebaseConfig object not found. Ensure it's defined in an inline script in your HTML before app.js is loaded.");
        }
    }
} catch (e) {
    console.error("Error initializing Firebase in app.js: ", e);
}


// Google Map and related objects
let map;
let infoWindow;
const markers = {}; // To store markers by point ID { pointId: google.maps.Marker }
const userPolylines = {}; // To store polylines by user ID { userId: google.maps.Polyline }
const userPathData = {}; // To store path coordinates { userId: [{lat, lng}, ...] }
const userColors = {}; // To store colors for users { userId: '#RRGGBB' }
let currentPathCreation = {
    isCreating: false,
    points: []
};

// DOM Elements
// These lines try to get references to HTML elements.
// Your app.js is loaded with 'defer', so these should correctly find the elements
// once the HTML is parsed.
const signInButton = document.getElementById('sign-in-button');
const signOutButton = document.getElementById('sign-out-button');
const userInfoDisplay = document.getElementById('user-info');
const togglePathButton = document.getElementById('toggle-path-button'); // Your "Start Path" button

// --- AUTHENTICATION ---
// This function runs whenever the user's sign-in state changes
if (auth) { // Proceed only if auth was successfully initialized
    auth.onAuthStateChanged(user => {
        if (user) {
            // User is signed in
            console.log('Auth state: Signed In:', user.uid);
            if(userInfoDisplay) userInfoDisplay.textContent = `Welcome, ${user.displayName || user.email}!`;
            
            // Show/hide auth-related buttons
            if(signInButton) signInButton.style.display = 'none';
            if(signOutButton) signOutButton.style.display = 'inline';
            if(userInfoDisplay) userInfoDisplay.style.display = 'inline';


            // Crucially, make the "Start Path" button visible.
            // Your HTML has it as style="display: none;" initially.
            // This JavaScript code overrides that to make it visible when a user is signed in.
            if (togglePathButton) {
                togglePathButton.style.display = 'inline'; // Or 'block', or other appropriate display value
                console.log('togglePathButton display set to inline (visible).');
            } else {
                // This error means the button with id="toggle-path-button" was not found in your HTML
                // when this script ran. Double-check the ID in your HTML and in the getElementById call.
                console.error('togglePathButton element not found in DOM during auth state change (signed in).');
            }

            // Fetch data for the logged-in user and other users
            setupFirestoreListeners(user.uid);
            assignUserColor(user.uid); // Assign color to current user

        } else {
            // User is signed out
            console.log('Auth state: Signed Out');
            if(userInfoDisplay) userInfoDisplay.textContent = '';

            // Show/hide auth-related buttons
            if(signInButton) signInButton.style.display = 'inline';
            if(signOutButton) signOutButton.style.display = 'none';
            if(userInfoDisplay) userInfoDisplay.style.display = 'none';


            // Hide "Start Path" button if it was found (or ensure it remains hidden)
            if (togglePathButton) {
                togglePathButton.style.display = 'none';
                console.log('togglePathButton display set to none (hidden).');
            } else {
                console.error('togglePathButton element not found in DOM during auth state change (signed out).');
            }

            // Clear map data
            clearAllMarkers();
            clearAllPolylines();
            updateLegend([]); // Potentially clear legend
        }
    });
} else {
    console.error("Firebase Auth service is not available. UI updates based on auth state will not work.");
}


if (signInButton) {
    signInButton.addEventListener('click', () => {
        if (auth) { // Check if auth is initialized
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(error => {
                console.error("Sign-in error", error);
            });
        } else {
            console.error("Cannot sign in: Firebase Auth not initialized.");
            alert("Authentication service is not available. Please try again later.");
        }
    });
} else {
    console.warn("Sign-in button (sign-in-button) not found in the DOM.");
}

if (signOutButton) {
    signOutButton.addEventListener('click', () => {
        if (auth) { // Check if auth is initialized
            auth.signOut().catch(error => {
                console.error("Sign-out error", error);
            });
        } else {
            console.error("Cannot sign out: Firebase Auth not initialized.");
        }
    });
} else {
    console.warn("Sign-out button (sign-out-button) not found in the DOM.");
}

// --- GOOGLE MAPS INITIALIZATION ---
// This function is called by the Google Maps API script tag (callback=initMap)
function initMap() {
    if (!document.getElementById('map')) {
        console.error("Map container element (#map) not found in DOM. Map cannot be initialized.");
        return;
    }
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 39.8283, lng: -98.5795 }, // Centered more on the US
        zoom: 4, // Adjusted zoom level
        // --- UPDATED MAP CONTROLS ---
        streetViewControl: true,    // Enables Pegman for Street View
        mapTypeControl: true,       // Allows toggling Map/Satellite
        fullscreenControl: true,    // Allows user to make map fullscreen
        zoomControl: true,          // Shows zoom controls
        scaleControl: true,         // Shows map scale
        rotateControl: true,        // Shows rotate control (for 45-degree imagery)
        // --- END OF UPDATED MAP CONTROLS ---
    });
    console.log('Map initialized with updated controls!');

    infoWindow = new google.maps.InfoWindow();
    console.log('InfoWindow initialized.');

    // --- MODIFIED MAP CLICK LISTENER WITH MORE LOGGING ---
    map.addListener('click', (mapsMouseEvent) => {
        console.log("Map clicked. Checking conditions to add point...");
        if (auth && auth.currentUser) {
            console.log("User is signed in:", auth.currentUser.uid);
            if (currentPathCreation.isCreating) {
                console.log("Path creation mode is active. Not adding new point. Showing info window.");
                infoWindow.setContent('Click on one of your existing markers to add it to the path, or click "End Path".');
                infoWindow.setPosition(mapsMouseEvent.latLng);
                infoWindow.open(map);
                return;
            }
            console.log("Path creation mode is NOT active. Proceeding to add point.");
            const pointData = {
                coordinates: new firebase.firestore.GeoPoint(mapsMouseEvent.latLng.lat(), mapsMouseEvent.latLng.lng()),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                userId: auth.currentUser.uid,
                note: "New stop"
            };
            if (db) {
                console.log("Attempting to add point to Firestore:", pointData);
                db.collection('points').add(pointData).then(docRef => {
                    console.log("Point successfully added to Firestore with ID: ", docRef.id);
                }).catch(error => {
                    console.error("Error adding point to Firestore: ", error);
                });
            } else {
                console.error("Firestore (db) not initialized. Cannot add point.");
                alert("Database not available. Cannot add point.");
            }
        } else {
            console.log("User is NOT signed in. Alerting user.");
            alert("Please sign in to add points.");
        }
    });
    console.log('Map click listener added.');
}
// Make initMap globally available for the Google Maps API callback
// This is important because the Google Maps script will look for window.initMap
window.initMap = initMap;

// --- FIRESTORE LISTENERS ---
function setupFirestoreListeners(currentUserIdInternal) {
    if (!db) { // Check if db is initialized
        console.error("Firestore (db) not initialized. Cannot set up listeners.");
        return;
    }
    // Clear existing listeners if any (to avoid duplicates on re-login)
    if (window.pointsListenerUnsubscribe) window.pointsListenerUnsubscribe();
    if (window.pathsListenerUnsubscribe) window.pathsListenerUnsubscribe();

    console.log('Setting up listener for ALL points...');
    window.pointsListenerUnsubscribe = db.collection('points').onSnapshot(snapshot => {
        console.log('Points snapshot: Processing', snapshot.size, 'points.');
        clearAllMarkers();
        const usersForLegend = new Set();
        snapshot.forEach(doc => {
            const point = doc.data();
            const pointId = doc.id;
            // Robust check for valid coordinates
            if (point.coordinates && typeof point.coordinates.latitude === 'number' && typeof point.coordinates.longitude === 'number') {
                assignUserColor(point.userId);
                drawMarker(pointId, point); // Pass full point data
                usersForLegend.add(point.userId);
            } else {
                console.warn("Invalid point data found (missing/invalid coordinates):", pointId, point);
            }
        });
        console.log('Finished updating map from points snapshot.');
        updateLegend(Array.from(usersForLegend));
        updatePolylineVisibilityBasedOnLegend();
    }, error => {
        console.error("Error fetching points: ", error);
    });

    console.log('Setting up listener for ALL paths...');
    window.pathsListenerUnsubscribe = db.collection('paths').onSnapshot(snapshot => {
        console.log('Paths snapshot:', snapshot.size, 'docs.');
        // Clear relevant polylines before redrawing
        snapshot.docChanges().forEach(change => {
            const pathUserId = change.doc.id; // Assuming doc ID is the user ID for the path
            if (userPolylines[pathUserId]) {
                userPolylines[pathUserId].setMap(null);
                delete userPolylines[pathUserId]; // Remove from our tracking object
            }
        });

        const usersForLegend = new Set(Object.keys(userColors)); // Start with users who have colors (likely from points)
        snapshot.forEach(doc => {
            const path = doc.data();
            const pathUserId = doc.id; // Assuming doc ID is the user ID for the path
            // Robust check for valid path coordinates
            if (path.coordinates && Array.isArray(path.coordinates) && path.coordinates.length > 1 &&
                path.coordinates.every(p => p && typeof p.latitude === 'number' && typeof p.longitude === 'number')) {
                userPathData[pathUserId] = path.coordinates.map(p => ({ lat: p.latitude, lng: p.longitude }));
                assignUserColor(pathUserId); // Ensure user has a color
                drawPolyline(pathUserId, userPathData[pathUserId]);
                usersForLegend.add(pathUserId);
            } else {
                console.warn("Invalid path data found:", pathUserId, path);
            }
        });
        console.log('Finished processing path snapshot.');
        updateLegend(Array.from(usersForLegend)); // Update legend with all users who have paths or points
        updatePolylineVisibilityBasedOnLegend();
    }, error => {
        console.error("Error fetching paths: ", error);
    });
}

// --- MAP DRAWING FUNCTIONS ---
function drawMarker(pointId, pointData) { // pointData contains all info about the point
    if (markers[pointId]) { // If marker already exists, remove it first
        markers[pointId].setMap(null);
    }

    const position = { lat: pointData.coordinates.latitude, lng: pointData.coordinates.longitude };
    const userColor = userColors[pointData.userId] || '#FE7569'; // Default color if not found

    // --- ADDED CHECK for google.maps.marker and PinElement ---
    if (!google.maps.marker || !google.maps.marker.PinElement) {
        console.error("Google Maps Marker library (for PinElement/AdvancedMarkerElement) not loaded correctly. Check API script tag for '&libraries=marker'.");
        // Fallback to old marker style if needed, or just return
        // For now, just log error and return to prevent further issues.
        return; 
    }
    // --- END OF ADDED CHECK ---

    const markerPin = new google.maps.marker.PinElement({
        background: userColor,
        borderColor: darkenColor(userColor, 20), // Darken border for better contrast
        glyphColor: "white", // Color of any glyph/icon inside the pin
    });
    const marker = new google.maps.marker.AdvancedMarkerElement({
        position: position,
        map: map,
        title: `User: ${pointData.userId}\nNote: ${pointData.note || ''}`, // Tooltip on hover
        content: markerPin.element, // Use the PinElement as content
    });

    // Store references for later use (e.g., click handling, deletion)
    marker.pointId = pointId;
    marker.pointOwnerUserId = pointData.userId; // Useful for legend filtering and permissions
    marker.pointData = pointData; // Store the full data object on the marker

    // Click listener for the marker
    marker.addListener('click', () => {
        if (currentPathCreation.isCreating && auth.currentUser && pointData.userId === auth.currentUser.uid) {
            // Add this marker's point to the current path being created
            const pointLocation = { lat: pointData.coordinates.latitude, lng: pointData.coordinates.longitude };
            currentPathCreation.points.push(pointLocation);
            console.log("Point added to current path:", pointLocation);
            if (currentPathCreation.points.length > 1) {
                drawTemporaryPolyline(currentPathCreation.points); // Update temporary visual path
            }
            infoWindow.close(); // Close any open info window
        } else if (auth.currentUser && pointData.userId === auth.currentUser.uid) {
            // Allow editing notes for own markers
            const content = document.createElement('div');
            // Use unique IDs for textarea and button to avoid conflicts if multiple infoWindows are somehow open
            content.innerHTML = `
                <div class="infowindow-content">
                    <p><strong>Note:</strong></p>
                    <textarea id="note-input-${pointId}" style="width:100%; height: 60px;">${pointData.note || ''}</textarea>
                    <button id="save-note-${pointId}">Save Note</button>
                </div>
            `;
            const saveNoteButton = content.querySelector(`#save-note-${pointId}`);
            saveNoteButton.addEventListener('click', () => {
                const newNote = content.querySelector(`#note-input-${pointId}`).value;
                if (db) {
                    db.collection('points').doc(pointId).update({ note: newNote })
                        .then(() => {
                            console.log("Note updated");
                            infoWindow.close();
                        })
                        .catch(error => console.error("Error updating note: ", error));
                }
            });
            infoWindow.setContent(content);
            // infoWindow.setPosition(position); // Not strictly needed for AdvancedMarkerElement with open(map, marker)
            infoWindow.open({map: map, anchor: marker}); // Recommended way for AdvancedMarkerElement
        } else {
            // For other users' markers, just show info
            infoWindow.setContent(`<div class="infowindow-content">User: ${pointData.userId}<br>Note: ${pointData.note || 'No note'}</div>`);
            // infoWindow.setPosition(position);
            infoWindow.open({map: map, anchor: marker});
        }
    });

    // Right-click to delete own marker (contextmenu for AdvancedMarkerElement)
    if (auth.currentUser && pointData.userId === auth.currentUser.uid) {
        marker.addListener('contextmenu', (e) => { // Note: 'contextmenu' event for AdvancedMarkerElement
            if (confirm("Are you sure you want to delete this marker?")) {
                if (db) {
                    db.collection('points').doc(pointId).delete()
                        .then(() => console.log("Marker deleted from Firestore:", pointId))
                        .catch(error => console.error("Error deleting marker from Firestore:", error));
                    // The Firestore listener will handle removing it from the map
                }
                infoWindow.close(); // Close info window if open on this marker
            }
        });
    }
    markers[pointId] = marker; // Store the marker
}

function drawPolyline(userId, pathCoordinates) {
    if (userPolylines[userId]) { // If polyline for this user already exists, remove it
        userPolylines[userId].setMap(null);
    }
    if (!map || !pathCoordinates || pathCoordinates.length < 2) return; // Need at least 2 points for a line

    const userColor = userColors[userId] || '#0000FF'; // Default blue if no color assigned
    const polyline = new google.maps.Polyline({
        path: pathCoordinates,
        geodesic: true,
        strokeColor: userColor,
        strokeOpacity: 1.0,
        strokeWeight: 3,
        map: map // Add polyline to the map
    });
    userPolylines[userId] = polyline; // Store the polyline

    // Ensure its visibility matches the legend checkbox
    const legendCheckbox = document.getElementById(`legend-user-${userId}`);
    if (legendCheckbox && !legendCheckbox.checked) {
        polyline.setMap(null); // Hide if unchecked in legend
    }
}

let temporaryPolyline = null; // To show path being created
function drawTemporaryPolyline(points) {
    if (temporaryPolyline) { // Clear previous temporary line
        temporaryPolyline.setMap(null);
    }
    if (points.length < 2) return; // Need at least 2 points

    temporaryPolyline = new google.maps.Polyline({
        path: points,
        geodesic: true,
        strokeColor: (auth.currentUser && userColors[auth.currentUser.uid]) || '#FF0000', // Current user's color or red
        strokeOpacity: 0.7, // Make it slightly transparent to distinguish
        strokeWeight: 4,    // Make it slightly thicker
        map: map,
        zIndex: 1000 // Ensure it's on top of other polylines
    });
}


function clearAllMarkers() {
    console.log('Clearing all markers from map.');
    for (const id in markers) {
        if (markers[id] && markers[id].setMap) { // Check if it's a valid marker object
             markers[id].setMap(null);
        }
    }
    // markers = {}; // Re-initializing here might cause issues if listeners are still processing
}

function clearAllPolylines() {
    console.log('Clearing all polylines from map.');
    for (const userId in userPolylines) {
        if (userPolylines[userId] && userPolylines[userId].setMap) {
            userPolylines[userId].setMap(null);
        }
    }
    // userPolylines = {};
}

// --- PATH CREATION BUTTON LOGIC ---
// This block is crucial for your button.
// It relies on 'togglePathButton' being a valid DOM element reference obtained earlier.
if (togglePathButton) {
    console.log('toggle-path-button found. Adding click listener.');
    togglePathButton.addEventListener('click', () => {
        if (!auth || !auth.currentUser) { // Check auth and currentUser
            alert("Please sign in to create a path.");
            return;
        }

        currentPathCreation.isCreating = !currentPathCreation.isCreating;
        if (currentPathCreation.isCreating) {
            togglePathButton.textContent = 'End Path';
            togglePathButton.classList.add('active'); // Add active class for styling
            currentPathCreation.points = []; // Reset points for the new path
            if(temporaryPolyline) temporaryPolyline.setMap(null); // Clear any old temp polyline
            alert("Path creation started. Click your markers in order to define the path. Click 'End Path' when finished.");
        } else {
            togglePathButton.textContent = 'Start Path';
            togglePathButton.classList.remove('active'); // Remove active class
            if (currentPathCreation.points.length > 1) {
                // Save the path to Firestore
                const pathDocId = auth.currentUser.uid; // Using user ID as path ID for simplicity (one path per user)
                                                        // For multiple paths per user, generate a unique ID.
                const pathCoordinatesForFirestore = currentPathCreation.points.map(p => new firebase.firestore.GeoPoint(p.lat, p.lng));

                if (db) { // Check if db is initialized
                    db.collection('paths').doc(pathDocId).set({ // Using .set() will overwrite existing path for this user
                        userId: auth.currentUser.uid,
                        coordinates: pathCoordinatesForFirestore,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    })
                    .then(() => {
                        console.log("Path saved for user:", auth.currentUser.uid);
                        alert("Path saved!");
                    })
                    .catch(error => {
                        console.error("Error saving path: ", error);
                        alert("Error saving path. See console for details.");
                    });
                } else {
                     console.error("Firestore (db) not initialized. Cannot save path.");
                }
            } else {
                alert("Path creation ended. Not enough points to save a path.");
            }
            // Clear temporary drawing
            if(temporaryPolyline) temporaryPolyline.setMap(null);
            currentPathCreation.points = [];
        }
    });
} else {
    // This error will appear in the console if the button isn't found when this script part runs.
    // This usually means getElementById returned null earlier.
    console.error("toggle-path-button element was not found in the DOM, so event listener cannot be added.");
}

// --- LEGEND ---
const legendContainer = document.getElementById('legend-container');

function updateLegend(userIds) {
    if (!legendContainer) {
        console.warn("Legend container (legend-container) not found in DOM.");
        return;
    }
    console.log("Updating legend for users:", userIds);
    // Clear previous legend items but keep the <h4> if it's static in HTML
    // If <h4> is dynamic, then legendContainer.innerHTML = '<h4>Legend</h4>'; is fine
    const existingList = legendContainer.querySelector('#legend-list');
    if (existingList) {
        existingList.innerHTML = ''; // Clear only the list items
    } else {
         legendContainer.innerHTML = ''; // Clear all if no list, then rebuild (including h4 if needed)
         const legendTitle = document.createElement('h4');
         legendTitle.textContent = 'Legend';
         legendContainer.appendChild(legendTitle);
         const newList = document.createElement('ul');
         newList.id = 'legend-list';
         legendContainer.appendChild(newList);
    }
    const legendList = legendContainer.querySelector('#legend-list') || legendContainer;


    userIds.forEach(userId => {
        const userColor = userColors[userId] || '#808080'; // Default gray
        let displayName = `User ${userId.substring(0, 6)}...`; // Default display
        if (auth && auth.currentUser && userId === auth.currentUser.uid) {
            displayName = `${auth.currentUser.displayName || 'You'} (You)`;
        }
        
        const listItem = document.createElement('li');
        // Using a label makes the text clickable to toggle the checkbox
        listItem.innerHTML = `
            <input type="checkbox" id="legend-user-${userId}" data-user-id="${userId}" checked style="margin-right: 5px;">
            <label for="legend-user-${userId}" style="display: inline-flex; align-items: center; cursor:pointer;">
                <span style="background-color:${userColor}; width:15px; height:15px; border-radius:50%; margin-right:8px; border:1px solid #555; display:inline-block;"></span>
                ${displayName}
            </label>
        `;
        legendList.appendChild(listItem);

        const checkbox = listItem.querySelector(`#legend-user-${userId}`);
        checkbox.addEventListener('change', handleLegendCheckboxChange);
    });
}

function handleLegendCheckboxChange(event) {
    const checkbox = event.target;
    const userId = checkbox.dataset.userId; // Get userId from data attribute
    const isChecked = checkbox.checked;

    // Toggle visibility of markers for this user
    for (const pointId in markers) {
        if (markers[pointId].pointOwnerUserId === userId) {
            markers[pointId].setMap(isChecked ? map : null);
        }
    }
    // Toggle visibility of polyline for this user
    if (userPolylines[userId]) {
        userPolylines[userId].setMap(isChecked ? map : null);
    }
}


function updatePolylineVisibilityBasedOnLegend() {
    console.log("Updating polyline and marker visibility based on legend state.");
    // Update polylines
    for (const userId in userPolylines) {
        if (userPolylines[userId]) { // Check if polyline object exists
            const checkbox = document.getElementById(`legend-user-${userId}`);
            // If checkbox exists, visibility depends on its state. If not, default to visible.
            userPolylines[userId].setMap(checkbox ? checkbox.checked : true);
        }
    }
    // Update markers
    for (const pointId in markers) {
        const marker = markers[pointId];
        if (marker && marker.pointOwnerUserId) { // Check if marker and its owner ID exist
            const checkbox = document.getElementById(`legend-user-${marker.pointOwnerUserId}`);
            // If checkbox exists, visibility depends on its state. If not, default to visible.
            marker.setMap(checkbox ? checkbox.checked : true);
        }
    }
}

// --- UTILITY FUNCTIONS ---
const distinctColors = [ // Predefined list of distinct colors
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#FED766", "#2AB7CA",
    "#F0B67F", "#FE4A49", "#547980", "#9DE0AD", "#F4A688"
    // Add more distinct colors if needed
];
let colorIndex = 0; // To cycle through distinctColors

function assignUserColor(userId) {
    if (!userColors[userId]) { // Assign a color only if user doesn't have one yet
        userColors[userId] = distinctColors[colorIndex % distinctColors.length];
        colorIndex++;
    }
    return userColors[userId];
}

function darkenColor(hex, percent) {
    hex = hex.replace(/^\s*#|\s*$/g, ''); // Remove # and spaces
    if (hex.length === 3) { // Expand shorthand hex "abc" to "aabbcc"
        hex = hex.replace(/(.)/g, '$1$1');
    }
    let r = parseInt(hex.substr(0, 2), 16),
        g = parseInt(hex.substr(2, 2), 16),
        b = parseInt(hex.substr(4, 2), 16);

    percent = Math.min(100, Math.max(0, percent)); // Clamp percent between 0 and 100

    // Apply darkening
    r = Math.round(r * (100 - percent) / 100);
    g = Math.round(g * (100 - percent) / 100);
    b = Math.round(b * (100 - percent) / 100);

    // Convert back to hex, ensuring 2 digits for each component
    return '#' +
        (r < 16 ? '0' : '') + r.toString(16) +
        (g < 16 ? '0' : '') + g.toString(16) +
        (b < 16 ? '0' : '') + b.toString(16);
}

// Final log to confirm script execution
console.log("app.js loaded and executed. Ensure Firebase config is correct and DOM elements exist.");
