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

    // !!! YOUR MAP ID IS USED HERE !!!
    const YOUR_MAP_ID = '374429077b81755441e361b8'; // Replace with your actual Map ID if different

    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 39.8283, lng: -98.5795 },
        zoom: 4,
        streetViewControl: true,
        mapTypeControl: true,
        fullscreenControl: true,
        zoomControl: true,
        scaleControl: true,
        rotateControl: true,
        mapId: YOUR_MAP_ID
    });
    console.log(`Map initialized with Map ID: ${YOUR_MAP_ID} and updated controls!`);

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
                note: "New stop" // Default note
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
        console.log('Points snapshot: Processing', snapshot.docChanges().length, 'changes for', snapshot.size, 'total points.');
        const usersForLegend = new Set(); // Collect all user IDs for legend update

        snapshot.docChanges().forEach(change => {
            const pointId = change.doc.id;
            const point = change.doc.data();

            if (change.type === "added" || change.type === "modified") {
                if (point.coordinates && typeof point.coordinates.latitude === 'number' && typeof point.coordinates.longitude === 'number') {
                    assignUserColor(point.userId); // Ensure color is assigned
                    drawMarker(pointId, point); // Add or update marker
                    usersForLegend.add(point.userId);
                } else {
                    console.warn("Invalid point data found (missing/invalid coordinates):", pointId, point);
                }
            } else if (change.type === "removed") {
                if (markers[pointId]) {
                    markers[pointId].setMap(null); // Remove marker from map
                    delete markers[pointId]; // Remove from our tracking object
                    console.log("Marker removed from map due to Firestore deletion:", pointId);
                }
            }
        });
        
        // After processing changes, ensure all existing markers are still valid
        // and collect all user IDs currently having markers for the legend.
        // This handles cases where initial load might miss some, or for a full refresh.
        clearAllMarkers(); // Clear existing markers before redrawing based on the full snapshot
        snapshot.forEach(doc => {
            const point = doc.data();
            const pointId = doc.id;
            if (point.coordinates && typeof point.coordinates.latitude === 'number' && typeof point.coordinates.longitude === 'number') {
                assignUserColor(point.userId);
                drawMarker(pointId, point);
                usersForLegend.add(point.userId);
            }
        });


        console.log('Finished updating map from points snapshot.');
        updateLegend(Array.from(usersForLegend));
        updatePolylineVisibilityBasedOnLegend(); // Ensure polylines also respect legend
    }, error => {
        console.error("Error fetching points: ", error);
    });

    console.log('Setting up listener for ALL paths...');
    window.pathsListenerUnsubscribe = db.collection('paths').onSnapshot(snapshot => {
        console.log('Paths snapshot: Processing', snapshot.docChanges().length, 'changes for', snapshot.size, 'total paths.');
        const usersWithPathsForLegend = new Set(Object.keys(userColors).filter(uid => userPathData[uid])); // Start with users we know have colors and paths

        snapshot.docChanges().forEach(change => {
            const pathUserId = change.doc.id; // Path document ID is the User ID
            const pathData = change.doc.data();

            if (change.type === "added" || change.type === "modified") {
                if (pathData.coordinates && Array.isArray(pathData.coordinates) && pathData.coordinates.length > 1 &&
                    pathData.coordinates.every(p => p && typeof p.latitude === 'number' && typeof p.longitude === 'number')) {
                    
                    userPathData[pathUserId] = pathData.coordinates.map(p => ({ lat: p.latitude, lng: p.longitude }));
                    assignUserColor(pathUserId); // Ensure color is assigned
                    drawPolyline(pathUserId, userPathData[pathUserId]);
                    usersWithPathsForLegend.add(pathUserId);
                } else {
                    console.warn("Invalid path data found:", pathUserId, pathData);
                    // If path becomes invalid, remove its polyline
                    if (userPolylines[pathUserId]) {
                        userPolylines[pathUserId].setMap(null);
                        delete userPolylines[pathUserId];
                        delete userPathData[pathUserId];
                    }
                }
            } else if (change.type === "removed") {
                if (userPolylines[pathUserId]) {
                    userPolylines[pathUserId].setMap(null);
                    delete userPolylines[pathUserId];
                    delete userPathData[pathUserId]; // Also clear the path data
                    console.log("Polyline removed for user:", pathUserId);
                }
            }
        });
        
        // Collect all user IDs for the legend (those with markers and those with paths)
        const allUserIdsForLegend = new Set(Object.keys(userColors)); // Get all users that have colors (points or paths)
        updateLegend(Array.from(allUserIdsForLegend));
        updatePolylineVisibilityBasedOnLegend();
        console.log('Finished processing path snapshot.');

    }, error => {
        console.error("Error fetching paths: ", error);
    });
}

// --- MAP DRAWING FUNCTIONS ---
function drawMarker(pointId, pointData) {
    if (!map || typeof map.setCenter !== 'function') {
        console.warn("drawMarker called but map is not ready. Aborting.");
        return;
    }
    // If marker already exists, remove it before redrawing (handles updates)
    if (markers[pointId]) {
        markers[pointId].setMap(null);
    }

    const position = { lat: pointData.coordinates.latitude, lng: pointData.coordinates.longitude };
    const userColor = userColors[pointData.userId] || '#FE7569'; // Default color if not assigned

    if (!google.maps.marker || !google.maps.marker.PinElement || !google.maps.marker.AdvancedMarkerElement) {
        console.error("Google Maps Marker library (for PinElement/AdvancedMarkerElement) not loaded correctly. Check API script tag for '&libraries=marker'.");
        // Fallback to old marker if AdvancedMarkerElement is not available (though it should be)
        const fallbackMarker = new google.maps.Marker({
            position: position,
            map: map,
            title: `User: ${pointData.userId}\nNote: ${pointData.note || ''}`
            // Add custom icon with color if desired for fallback
        });
        markers[pointId] = fallbackMarker; // Store fallback marker
        // Note: Right-click delete might not work as intended for this fallback without further adjustments.
        return;
    }

    const markerPin = new google.maps.marker.PinElement({
        background: userColor,
        borderColor: darkenColor(userColor, 20), // Darken border for contrast
        glyphColor: "white", // Glyph color
    });

    const marker = new google.maps.marker.AdvancedMarkerElement({
        position: position,
        map: map,
        title: `User: ${pointData.userId}\nNote: ${pointData.note || ''}`,
        content: markerPin.element, // Set the PinElement as the content
    });

    // Store point data with the marker object for easy access
    marker.pointId = pointId;
    marker.pointOwnerUserId = pointData.userId;
    marker.pointData = pointData; // Store the full point data

    // Standard click listener (for info window / path creation)
    marker.addListener('click', () => {
        console.log(`Marker clicked: ${pointId}, owned by ${pointData.userId}. Current user: ${auth.currentUser ? auth.currentUser.uid : 'none'}`);
        if (currentPathCreation.isCreating && auth.currentUser && pointData.userId === auth.currentUser.uid) {
            const pointLocation = { lat: pointData.coordinates.latitude, lng: pointData.coordinates.longitude };
            currentPathCreation.points.push(pointLocation);
            console.log("Point added to current path:", pointLocation, "Total points:", currentPathCreation.points.length);
            if (currentPathCreation.points.length > 1) {
                drawTemporaryPolyline(currentPathCreation.points);
            }
            infoWindow.close(); // Close info window if open
        } else if (auth.currentUser && pointData.userId === auth.currentUser.uid) {
            // User owns this marker - allow editing note
            const content = document.createElement('div');
            content.className = 'infowindow-content p-2'; // Added padding class
            content.innerHTML = `
                <p class="font-semibold mb-1">Note:</p>
                <textarea id="note-input-${pointId}" class="w-full h-16 p-1 border border-gray-300 rounded mb-2">${pointData.note || ''}</textarea>
                <button id="save-note-${pointId}" class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">Save Note</button>
            `;
            const saveNoteButton = content.querySelector(`#save-note-${pointId}`);
            saveNoteButton.addEventListener('click', () => {
                const newNote = content.querySelector(`#note-input-${pointId}`).value;
                if (db) {
                    db.collection('points').doc(pointId).update({ note: newNote })
                        .then(() => {
                            console.log("Note updated for pointId:", pointId);
                            infoWindow.close();
                            // The marker's title will be updated on the next Firestore snapshot if title includes note.
                            // Or, you can update it directly:
                            // marker.title = `User: ${pointData.userId}\nNote: ${newNote}`;
                            // pointData.note = newNote; // Update local copy
                        })
                        .catch(error => console.error("Error updating note: ", error));
                }
            });
            infoWindow.setContent(content);
            infoWindow.open({ map: map, anchor: marker });
        } else {
            // User does not own this marker - display read-only info
            infoWindow.setContent(`<div class="infowindow-content p-2"><p class="font-semibold">User:</p><p>${pointData.userId.substring(0,10)}...</p><p class="font-semibold mt-1">Note:</p><p>${pointData.note || 'No note'}</p></div>`);
            infoWindow.open({ map: map, anchor: marker });
        }
    });

    // MODIFIED: Contextmenu (right-click) listener for deletion
    // Attach to marker.content for AdvancedMarkerElement
    if (marker.content && auth.currentUser && pointData.userId === auth.currentUser.uid) {
        marker.content.addEventListener('contextmenu', (event) => {
            event.preventDefault(); // IMPORTANT: Prevent default browser context menu

            console.log(`Right-click detected on marker ${pointId} (owned by current user ${auth.currentUser.uid}).`);

            if (confirm("Are you sure you want to delete this marker?")) {
                if (db) {
                    console.log(`Attempting to delete marker ${pointId} from Firestore.`);
                    db.collection('points').doc(pointId).delete()
                        .then(() => {
                            console.log("Marker deletion command sent to Firestore for:", pointId);
                            // Firestore's onSnapshot listener will handle removing the marker from the map
                        })
                        .catch(error => {
                            console.error("Error deleting marker from Firestore:", pointId, error);
                            alert("Error deleting marker. See console for details.");
                        });
                } else {
                    console.error("Firestore (db) not initialized. Cannot delete marker.");
                    alert("Database not available. Cannot delete marker.");
                }
                // Close info window if it was open on this marker
                if (infoWindow && infoWindow.getMap() && infoWindow.anchor === marker) {
                    infoWindow.close();
                }
            }
        });
        console.log(`Contextmenu listener successfully ADDED to marker.content for pointId: ${pointId}`);
    } else {
        // Log why listener wasn't added, if relevant for debugging
        if (!marker.content) {
            console.warn(`Contextmenu listener NOT added for pointId: ${pointId} because marker.content is null.`);
        } else if (!auth.currentUser) {
            // console.log(`Contextmenu listener NOT added for pointId: ${pointId} because user is not logged in.`);
        } else if (pointData.userId !== auth.currentUser.uid) {
            // console.log(`Contextmenu listener NOT added for pointId: ${pointId} because user ${auth.currentUser.uid} does not own it (owner: ${pointData.userId}).`);
        }
    }
    markers[pointId] = marker; // Store the marker
}


function drawPolyline(userId, pathCoordinates) {
    if (userPolylines[userId]) {
        userPolylines[userId].setMap(null); // Remove old polyline before drawing new one
    }
    if (!map || typeof map.setCenter !== 'function' || !pathCoordinates || pathCoordinates.length < 2) {
        console.warn("drawPolyline called but map not ready or invalid pathCoordinates. Aborting for userId:", userId);
        return;
    }
    const userColor = userColors[userId] || '#0000FF'; // Default blue if no color assigned
    const polyline = new google.maps.Polyline({
        path: pathCoordinates,
        geodesic: true,
        strokeColor: userColor,
        strokeOpacity: 1.0,
        strokeWeight: 3,
        map: map // Initially add to map, visibility will be controlled by legend
    });
    userPolylines[userId] = polyline;
    console.log("Polyline drawn for user:", userId, "with color:", userColor);

    // Ensure visibility is set according to the legend checkbox
    const legendCheckbox = document.getElementById(`legend-user-${userId}`);
    polyline.setMap(legendCheckbox && legendCheckbox.checked ? map : null);
}

let temporaryPolyline = null;
function drawTemporaryPolyline(points) {
    if (temporaryPolyline) {
        temporaryPolyline.setMap(null); // Clear previous temporary polyline
    }
    if (!map || typeof map.setCenter !== 'function' || !points || points.length < 2) {
         console.warn("drawTemporaryPolyline called but map not ready or not enough points. Aborting.");
        return;
    }

    const currentUserColor = (auth.currentUser && userColors[auth.currentUser.uid]) ? userColors[auth.currentUser.uid] : '#FF0000'; // Default to red if no user color

    temporaryPolyline = new google.maps.Polyline({
        path: points,
        geodesic: true,
        strokeColor: currentUserColor,
        strokeOpacity: 0.7, // Slightly transparent
        strokeWeight: 4,    // Slightly thicker
        map: map,
        zIndex: 1000 // Ensure it's above other polylines
    });
    console.log("Temporary polyline drawn with points:", points.length);
}

function clearAllMarkers() {
    console.log('Clearing all markers from map. Current marker count:', Object.keys(markers).length);
    for (const id in markers) {
        if (markers[id] && typeof markers[id].setMap === 'function') { // Check if setMap exists
             markers[id].setMap(null);
        }
        delete markers[id]; // Also remove from the tracking object
    }
    // markers = {}; // Re-initialize after clearing, though deleting individually also works.
    console.log('All markers cleared. Marker count now:', Object.keys(markers).length);
}


function clearAllPolylines() {
    console.log('Clearing all polylines from map. Current polyline count:', Object.keys(userPolylines).length);
    for (const userId in userPolylines) {
        if (userPolylines[userId] && userPolylines[userId].setMap) {
            userPolylines[userId].setMap(null);
        }
        delete userPolylines[userId]; // Also remove from the tracking object
    }
    // userPolylines = {}; // Re-initialize
    console.log('All polylines cleared. Polyline count now:', Object.keys(userPolylines).length);
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
            togglePathButton.classList.add('active', 'bg-red-500', 'hover:bg-red-600'); // Active styling
            togglePathButton.classList.remove('bg-green-500', 'hover:bg-green-600');
            currentPathCreation.points = [];
            if(temporaryPolyline) temporaryPolyline.setMap(null); // Clear any old temp polyline
            alert("Path creation started. Click your markers in order (oldest to newest) to define the path. Click 'End Path' when finished.");
            console.log("Path creation started.");
        } else {
            togglePathButton.textContent = 'Start Path';
            togglePathButton.classList.remove('active', 'bg-red-500', 'hover:bg-red-600');
            togglePathButton.classList.add('bg-green-500', 'hover:bg-green-600'); // Default styling

            if (currentPathCreation.points.length > 1) {
                const pathDocId = auth.currentUser.uid; // Path ID is the user's UID
                const pathCoordinatesForFirestore = currentPathCreation.points.map(p => new firebase.firestore.GeoPoint(p.lat, p.lng));
                if (db) {
                    console.log("Attempting to save path for user:", auth.currentUser.uid, "with points:", currentPathCreation.points);
                    db.collection('paths').doc(pathDocId).set({ // Use set to overwrite existing path for the user
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
                     alert("Database not available. Cannot save path.");
                }
            } else {
                alert("Path creation ended. Not enough points (at least 2 required) to save a path.");
                console.log("Path creation ended, not enough points.");
            }
            if(temporaryPolyline) temporaryPolyline.setMap(null); // Clear temp polyline
            currentPathCreation.points = []; // Reset points
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
    console.log("Updating legend for user IDs:", userIds);

    let legendList = legendContainer.querySelector('#legend-list');
    if (!legendList) {
        legendContainer.innerHTML = ''; // Clear previous content if structure was different
        const legendTitle = document.createElement('h4');
        legendTitle.textContent = 'Legend';
        legendTitle.className = 'text-lg font-semibold mb-2';
        legendContainer.appendChild(legendTitle);
        legendList = document.createElement('ul');
        legendList.id = 'legend-list';
        legendList.className = 'space-y-1';
        legendContainer.appendChild(legendList);
    } else {
        legendList.innerHTML = ''; // Clear existing list items
    }

    const uniqueUserIds = Array.from(new Set(userIds)); // Ensure unique IDs

    uniqueUserIds.forEach(userId => {
        const userColor = userColors[userId] || '#808080'; // Default gray for unknown
        let displayName = `User ${userId.substring(0, 6)}...`;
        if (auth && auth.currentUser && userId === auth.currentUser.uid) {
            displayName = `${auth.currentUser.displayName || 'You'} (You)`;
        } else if (auth && auth.currentUser) {
            // Potentially fetch display names for other users if needed, or use a generic one
            // For now, stick to User ID for others.
        }


        const listItem = document.createElement('li');
        listItem.className = 'flex items-center';
        listItem.innerHTML = `
            <input type="checkbox" id="legend-user-${userId}" data-user-id="${userId}" checked class="mr-2 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500">
            <label for="legend-user-${userId}" class="flex items-center cursor-pointer">
                <span style="background-color:${userColor}; width:15px; height:15px; border-radius:50%; margin-right:8px; border:1px solid #555; display:inline-block;"></span>
                <span class="text-sm">${displayName}</span>
            </label>
        `;
        legendList.appendChild(listItem);
        const checkbox = listItem.querySelector(`#legend-user-${userId}`);
        checkbox.addEventListener('change', handleLegendCheckboxChange);
    });
    if (uniqueUserIds.length === 0) {
        legendList.innerHTML = '<li class="text-sm text-gray-500">No users with data on map.</li>';
    }
}

function handleLegendCheckboxChange(event) {
    const checkbox = event.target;
    const userId = checkbox.dataset.userId;
    const isChecked = checkbox.checked;
    console.log(`Legend checkbox changed for user ${userId}: ${isChecked ? 'checked' : 'unchecked'}`);
    const targetMap = isChecked ? map : null;

    // Toggle visibility for markers of this user
    for (const pointId in markers) {
        if (markers[pointId] && markers[pointId].pointOwnerUserId === userId) {
            markers[pointId].setMap(targetMap);
        }
    }
    // Toggle visibility for polyline of this user
    if (userPolylines[userId]) {
        userPolylines[userId].setMap(targetMap);
    }
}

function updatePolylineVisibilityBasedOnLegend() {
    console.log("Updating polyline and marker visibility based on legend state.");
    if (!map || typeof map.setCenter !== 'function') {
        console.warn("Map object not ready in updatePolylineVisibilityBasedOnLegend. Aborting visibility update.");
        return;
    }
    // Update polylines
    for (const userId in userPolylines) {
        if (userPolylines[userId]) {
            const checkbox = document.getElementById(`legend-user-${userId}`);
            userPolylines[userId].setMap(checkbox && checkbox.checked ? map : null);
        }
    }
    // Update markers
    for (const pointId in markers) {
        const marker = markers[pointId];
        if (marker && marker.pointOwnerUserId) {
            const checkbox = document.getElementById(`legend-user-${marker.pointOwnerUserId}`);
            marker.setMap(checkbox && checkbox.checked ? map : null);
        }
    }
}


const distinctColors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#FED766", "#2AB7CA",
    "#F0B67F", "#FE4A49", "#547980", "#9DE0AD", "#F4A688",
    "#8A2BE2", "#FF1493", "#00CED1", "#FFD700", "#32CD32" // Added more colors
];
let colorIndex = 0;
function assignUserColor(userId) {
    if (!userColors[userId]) {
        userColors[userId] = distinctColors[colorIndex % distinctColors.length];
        colorIndex++;
        console.log(`Assigned color ${userColors[userId]} to user ${userId}`);
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
    percent = Math.min(100, Math.max(0, percent)); // Ensure percent is between 0 and 100
    r = Math.max(0, Math.round(r * (100 - percent) / 100)); // Ensure color component doesn't go below 0
    g = Math.max(0, Math.round(g * (100 - percent) / 100));
    b = Math.max(0, Math.round(b * (100 - percent) / 100));
    return '#' +
        (r < 16 ? '0' : '') + r.toString(16) +
        (g < 16 ? '0' : '') + g.toString(16) +
        (b < 16 ? '0' : '') + b.toString(16);
}
console.log("app.js loaded and executed. Ensure Firebase config is correct and DOM elements exist.");

// Ensure the initMap function is globally available if the Maps API script loads asynchronously and calls it.
window.initMap = initMap;

