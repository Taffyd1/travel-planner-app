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
let map; // This will hold the Google Map instance
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
const signInButton = document.getElementById('sign-in-button');
const signOutButton = document.getElementById('sign-out-button');
const userInfoDisplay = document.getElementById('user-info');
const togglePathButton = document.getElementById('toggle-path-button'); 

// --- AUTHENTICATION ---
if (auth) { 
    auth.onAuthStateChanged(user => {
        if (user) {
            console.log('Auth state: Signed In:', user.uid);
            if(userInfoDisplay) userInfoDisplay.textContent = `Welcome, ${user.displayName || user.email}!`;
            if(signInButton) signInButton.style.display = 'none';
            if(signOutButton) signOutButton.style.display = 'inline';
            if(userInfoDisplay) userInfoDisplay.style.display = 'inline';

            if (togglePathButton) {
                togglePathButton.style.display = 'inline'; 
                console.log('togglePathButton display set to inline (visible).');
            } else {
                console.error('togglePathButton element not found in DOM during auth state change (signed in).');
            }
            setupFirestoreListeners(user.uid);
            assignUserColor(user.uid); 
        } else {
            console.log('Auth state: Signed Out');
            if(userInfoDisplay) userInfoDisplay.textContent = '';
            if(signInButton) signInButton.style.display = 'inline';
            if(signOutButton) signOutButton.style.display = 'none';
            if(userInfoDisplay) userInfoDisplay.style.display = 'none';

            if (togglePathButton) {
                togglePathButton.style.display = 'none';
                console.log('togglePathButton display set to none (hidden).');
            } else {
                console.error('togglePathButton element not found in DOM during auth state change (signed out).');
            }
            clearAllMarkers();
            clearAllPolylines();
            updateLegend([]); 
        }
    });
} else {
    console.error("Firebase Auth service is not available. UI updates based on auth state will not work.");
}

if (signInButton) {
    signInButton.addEventListener('click', () => {
        if (auth) { 
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
        if (auth) { 
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
function initMap() {
    if (!document.getElementById('map')) {
        console.error("Map container element (#map) not found in DOM. Map cannot be initialized.");
        return;
    }
    map = new google.maps.Map(document.getElementById('map'), { // Assign to global 'map'
        center: { lat: 39.8283, lng: -98.5795 }, 
        zoom: 4, 
        streetViewControl: true,    
        mapTypeControl: true,       
        fullscreenControl: true,    
        zoomControl: true,          
        scaleControl: true,         
        rotateControl: true,        
    });
    console.log('Map initialized with updated controls!');

    infoWindow = new google.maps.InfoWindow();
    console.log('InfoWindow initialized.');

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
window.initMap = initMap;

// --- FIRESTORE LISTENERS ---
function setupFirestoreListeners(currentUserIdInternal) {
    if (!db) { 
        console.error("Firestore (db) not initialized. Cannot set up listeners.");
        return;
    }
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
            if (point.coordinates && typeof point.coordinates.latitude === 'number' && typeof point.coordinates.longitude === 'number') {
                assignUserColor(point.userId);
                drawMarker(pointId, point); 
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
        snapshot.docChanges().forEach(change => {
            const pathUserId = change.doc.id; 
            if (userPolylines[pathUserId]) {
                userPolylines[pathUserId].setMap(null);
                delete userPolylines[pathUserId]; 
            }
        });
        const usersForLegend = new Set(Object.keys(userColors)); 
        snapshot.forEach(doc => {
            const path = doc.data();
            const pathUserId = doc.id; 
            if (path.coordinates && Array.isArray(path.coordinates) && path.coordinates.length > 1 &&
                path.coordinates.every(p => p && typeof p.latitude === 'number' && typeof p.longitude === 'number')) {
                userPathData[pathUserId] = path.coordinates.map(p => ({ lat: p.latitude, lng: p.longitude }));
                assignUserColor(pathUserId); 
                drawPolyline(pathUserId, userPathData[pathUserId]);
                usersForLegend.add(pathUserId);
            } else {
                console.warn("Invalid path data found:", pathUserId, path); // Log specific path ID
            }
        });
        console.log('Finished processing path snapshot.');
        updateLegend(Array.from(usersForLegend)); 
        updatePolylineVisibilityBasedOnLegend();
    }, error => {
        console.error("Error fetching paths: ", error);
    });
}

// --- MAP DRAWING FUNCTIONS ---
function drawMarker(pointId, pointData) { 
    if (!map || typeof map.setCenter !== 'function') { // Check if map is initialized
        console.warn("drawMarker called but map is not ready. Aborting.");
        return;
    }
    if (markers[pointId]) { 
        markers[pointId].setMap(null);
    }
    const position = { lat: pointData.coordinates.latitude, lng: pointData.coordinates.longitude };
    const userColor = userColors[pointData.userId] || '#FE7569'; 

    if (!google.maps.marker || !google.maps.marker.PinElement) {
        console.error("Google Maps Marker library (for PinElement/AdvancedMarkerElement) not loaded correctly. Check API script tag for '&libraries=marker'.");
        return; 
    }

    const markerPin = new google.maps.marker.PinElement({
        background: userColor,
        borderColor: darkenColor(userColor, 20), 
        glyphColor: "white", 
    });
    const marker = new google.maps.marker.AdvancedMarkerElement({
        position: position,
        map: map, // Assign the global map object here
        title: `User: ${pointData.userId}\nNote: ${pointData.note || ''}`, 
        content: markerPin.element, 
    });

    marker.pointId = pointId;
    marker.pointOwnerUserId = pointData.userId; 
    marker.pointData = pointData; 

    marker.addListener('click', () => {
        if (currentPathCreation.isCreating && auth.currentUser && pointData.userId === auth.currentUser.uid) {
            const pointLocation = { lat: pointData.coordinates.latitude, lng: pointData.coordinates.longitude };
            currentPathCreation.points.push(pointLocation);
            console.log("Point added to current path:", pointLocation);
            if (currentPathCreation.points.length > 1) {
                drawTemporaryPolyline(currentPathCreation.points); 
            }
            infoWindow.close(); 
        } else if (auth.currentUser && pointData.userId === auth.currentUser.uid) {
            const content = document.createElement('div');
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
            infoWindow.open({map: map, anchor: marker}); 
        } else {
            infoWindow.setContent(`<div class="infowindow-content">User: ${pointData.userId}<br>Note: ${pointData.note || 'No note'}</div>`);
            infoWindow.open({map: map, anchor: marker});
        }
    });

    if (auth.currentUser && pointData.userId === auth.currentUser.uid) {
        marker.addListener('contextmenu', (e) => { 
            if (confirm("Are you sure you want to delete this marker?")) {
                if (db) {
                    db.collection('points').doc(pointId).delete()
                        .then(() => console.log("Marker deleted from Firestore:", pointId))
                        .catch(error => console.error("Error deleting marker from Firestore:", error));
                }
                infoWindow.close(); 
            }
        });
    }
    markers[pointId] = marker; 
}

function drawPolyline(userId, pathCoordinates) {
    if (userPolylines[userId]) { 
        userPolylines[userId].setMap(null);
    }
    if (!map || typeof map.setCenter !== 'function' || !pathCoordinates || pathCoordinates.length < 2) {
        console.warn("drawPolyline called but map not ready or invalid pathCoordinates. Aborting.");
        return;
    }
    const userColor = userColors[userId] || '#0000FF'; 
    const polyline = new google.maps.Polyline({
        path: pathCoordinates,
        geodesic: true,
        strokeColor: userColor,
        strokeOpacity: 1.0,
        strokeWeight: 3,
        map: map 
    });
    userPolylines[userId] = polyline; 

    const legendCheckbox = document.getElementById(`legend-user-${userId}`);
    // Correctly use map or null for setMap
    polyline.setMap(legendCheckbox && legendCheckbox.checked ? map : null);
}

let temporaryPolyline = null; 
function drawTemporaryPolyline(points) {
    if (temporaryPolyline) { 
        temporaryPolyline.setMap(null);
    }
    if (!map || typeof map.setCenter !== 'function' || points.length < 2) {
         console.warn("drawTemporaryPolyline called but map not ready or not enough points. Aborting.");
        return;
    }

    temporaryPolyline = new google.maps.Polyline({
        path: points,
        geodesic: true,
        strokeColor: (auth.currentUser && userColors[auth.currentUser.uid]) || '#FF0000', 
        strokeOpacity: 0.7, 
        strokeWeight: 4,    
        map: map,
        zIndex: 1000 
    });
}

function clearAllMarkers() {
    console.log('Clearing all markers from map.');
    for (const id in markers) {
        if (markers[id] && markers[id].setMap) { 
             markers[id].setMap(null);
        }
    }
}

function clearAllPolylines() {
    console.log('Clearing all polylines from map.');
    for (const userId in userPolylines) {
        if (userPolylines[userId] && userPolylines[userId].setMap) {
            userPolylines[userId].setMap(null);
        }
    }
}

if (togglePathButton) {
    console.log('toggle-path-button found. Adding click listener.');
    togglePathButton.addEventListener('click', () => {
        if (!auth || !auth.currentUser) { 
            alert("Please sign in to create a path.");
            return;
        }
        currentPathCreation.isCreating = !currentPathCreation.isCreating;
        if (currentPathCreation.isCreating) {
            togglePathButton.textContent = 'End Path';
            togglePathButton.classList.add('active'); 
            currentPathCreation.points = []; 
            if(temporaryPolyline) temporaryPolyline.setMap(null); 
            alert("Path creation started. Click your markers in order to define the path. Click 'End Path' when finished.");
        } else {
            togglePathButton.textContent = 'Start Path';
            togglePathButton.classList.remove('active'); 
            if (currentPathCreation.points.length > 1) {
                const pathDocId = auth.currentUser.uid; 
                const pathCoordinatesForFirestore = currentPathCreation.points.map(p => new firebase.firestore.GeoPoint(p.lat, p.lng));
                if (db) { 
                    db.collection('paths').doc(pathDocId).set({ 
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
            if(temporaryPolyline) temporaryPolyline.setMap(null);
            currentPathCreation.points = [];
        }
    });
} else {
    console.error("toggle-path-button element was not found in the DOM, so event listener cannot be added.");
}

const legendContainer = document.getElementById('legend-container');
function updateLegend(userIds) {
    if (!legendContainer) {
        console.warn("Legend container (legend-container) not found in DOM.");
        return;
    }
    console.log("Updating legend for users:", userIds);
    const existingList = legendContainer.querySelector('#legend-list');
    if (existingList) {
        existingList.innerHTML = ''; 
    } else {
         legendContainer.innerHTML = ''; 
         const legendTitle = document.createElement('h4');
         legendTitle.textContent = 'Legend';
         legendContainer.appendChild(legendTitle);
         const newList = document.createElement('ul');
         newList.id = 'legend-list';
         legendContainer.appendChild(newList);
    }
    const legendList = legendContainer.querySelector('#legend-list') || legendContainer;

    userIds.forEach(userId => {
        const userColor = userColors[userId] || '#808080'; 
        let displayName = `User ${userId.substring(0, 6)}...`; 
        if (auth && auth.currentUser && userId === auth.currentUser.uid) {
            displayName = `${auth.currentUser.displayName || 'You'} (You)`;
        }
        
        const listItem = document.createElement('li');
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
    const userId = checkbox.dataset.userId; 
    const isChecked = checkbox.checked;

    // Correctly use map or null for setMap
    const targetMap = isChecked ? map : null;

    for (const pointId in markers) {
        if (markers[pointId].pointOwnerUserId === userId) {
            markers[pointId].setMap(targetMap);
        }
    }
    if (userPolylines[userId]) {
        userPolylines[userId].setMap(targetMap);
    }
}

// --- CORRECTED updatePolylineVisibilityBasedOnLegend ---
function updatePolylineVisibilityBasedOnLegend() {
    console.log("Updating polyline and marker visibility based on legend state.");
    if (!map || typeof map.setCenter !== 'function') { // Check if map is a valid Google Map object
        console.warn("Map object not ready in updatePolylineVisibilityBasedOnLegend. Aborting visibility update.");
        return;
    }

    // Update polylines
    for (const userId in userPolylines) {
        if (userPolylines[userId]) { 
            const checkbox = document.getElementById(`legend-user-${userId}`);
            // If checkbox exists and is checked, show on map; otherwise, remove (setMap(null))
            userPolylines[userId].setMap(checkbox && checkbox.checked ? map : null);
        }
    }
    // Update markers
    for (const pointId in markers) {
        const marker = markers[pointId];
        if (marker && marker.pointOwnerUserId) { 
            const checkbox = document.getElementById(`legend-user-${marker.pointOwnerUserId}`);
            // If checkbox exists and is checked, show on map; otherwise, remove (setMap(null))
            marker.setMap(checkbox && checkbox.checked ? map : null);
        }
    }
}

const distinctColors = [ 
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#FED766", "#2AB7CA",
    "#F0B67F", "#FE4A49", "#547980", "#9DE0AD", "#F4A688"
];
let colorIndex = 0; 
function assignUserColor(userId) {
    if (!userColors[userId]) { 
        userColors[userId] = distinctColors[colorIndex % distinctColors.length];
        colorIndex++;
    }
    return userColors[userId];
}

function darkenColor(hex, percent) {
    hex = hex.replace(/^\s*#|\s*$/g, ''); 
    if (hex.length === 3) { 
        hex = hex.replace(/(.)/g, '$1$1');
    }
    let r = parseInt(hex.substr(0, 2), 16),
        g = parseInt(hex.substr(2, 2), 16),
        b = parseInt(hex.substr(4, 2), 16);
    percent = Math.min(100, Math.max(0, percent)); 
    r = Math.round(r * (100 - percent) / 100);
    g = Math.round(g * (100 - percent) / 100);
    b = Math.round(b * (100 - percent) / 100);
    return '#' +
        (r < 16 ? '0' : '') + r.toString(16) +
        (g < 16 ? '0' : '') + g.toString(16) +
        (b < 16 ? '0' : '') + b.toString(16);
}
console.log("app.js loaded and executed. Ensure Firebase config is correct and DOM elements exist.");
