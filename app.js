// --- app.js FINAL VERSION (Auth, Firestore, Real-time, Legend, Visibility, Path) ---

// Global variables
let map = null;
let infoWindow = null;
let markersOnMap = {};    // { firestoreId: markerObject }
let polylinesOnMap = {};  // { userId: polylineObject }
let displayedUsers = {}; // { userId: { displayName: '...', color: '...', isVisible: true } }
let routeSequence = [];   // Runtime route sequence for the CURRENT user editing
let isConnectMode = false;
const PATH_COLLECTION = "paths";
const POINTS_COLLECTION = "points";
let currentUserId = null;
let currentUserColor = '#CCCCCC';
let auth = null;
let db = null;
let pointsListener = null; // Firestore listener unsubscribe function
let allPathsListener = null; // Listener for ALL path documents

// Predefined list of colors
const userColors = ['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080', '#FFC0CB', '#4682B4', '#FFD700'];

// Simple function to get a consistent color based on userId
function getUserColor(userId) {
    if (!userId) { return '#CCCCCC'; }
    let hash = 0;
    for (let i = 0; i < userId.length; i++) { hash = userId.charCodeAt(i) + ((hash << 5) - hash); hash = hash & hash; }
    const index = Math.abs(hash % userColors.length);
    return userColors[index];
}

// Main initialization function called by Google Maps API callback
function initMap() {
    if (!window.db || !firebase.auth) { console.error("Firebase services not ready."); return; }
    db = window.db; auth = firebase.auth();
    currentUserId = null; currentUserColor = '#CCCCCC';

    const mapCenter = { lat: 39.108, lng: -84.805 }; // Centered on Dry Run, OH approx
    const mapOptions = { zoom: 14, center: mapCenter, mapTypeId: 'roadmap' };
    map = new google.maps.Map(document.getElementById('map'), mapOptions);
    console.log("Map initialized!");
    infoWindow = new google.maps.InfoWindow();
    console.log("InfoWindow initialized.");
    // Polylines created dynamically by listener now

    // Get UI Elements
    const signInButton = document.getElementById('sign-in-button');
    const signOutButton = document.getElementById('sign-out-button');
    const userInfoSpan = document.getElementById('user-info');
    const userNameSpan = document.getElementById('user-name');
    const togglePathButton = document.getElementById('toggle-path-button');

    // Setup Auth State Listener
    auth.onAuthStateChanged((user) => {
        // Detach previous listeners
        if (pointsListener) { console.log("Detaching points listener."); pointsListener(); pointsListener = null; }
        if (allPathsListener) { console.log("Detaching paths listener."); allPathsListener(); allPathsListener = null; }
        clearAllMarkers(); clearAllPolylines(); routeSequence = []; displayedUsers = {}; updateLegend();

        if (user) { // User is signed in
            currentUserId = user.uid; currentUserColor = getUserColor(currentUserId);
            console.log("Auth state: Signed In:", currentUserId, currentUserColor);
            updateAuthUI(user); // Update buttons/welcome message
            // *** Start listeners for this user's data ***
            listenForAllPaths(); // Listen for ALL paths
            listenForPointChanges(); // Listen for ALL points
        } else { // User is signed out
            currentUserId = null; currentUserColor = '#CCCCCC';
            console.log("Auth state: Signed Out");
            updateAuthUI(null); // Update buttons/welcome message
        }
    }); // End of onAuthStateChanged

    // Setup Button Listeners
    if (signInButton) signInButton.addEventListener('click', signInWithGoogle);
    else console.error("Sign-in button missing from HTML or ID mismatch.");
    if (signOutButton) signOutButton.addEventListener('click', signOutUser);
    else console.error("Sign-out button missing from HTML or ID mismatch.");
    if (togglePathButton) {
        togglePathButton.addEventListener('click', function() {
            if (!currentUserId) return;
            isConnectMode = !isConnectMode;
            if (isConnectMode) { // Entering connect mode
                routeSequence = []; // Clear runtime editing sequence
                // Ensure current user's polyline exists for editing
                if (!polylinesOnMap[currentUserId]) {
                     polylinesOnMap[currentUserId] = new google.maps.Polyline({ geodesic: true, strokeOpacity: 1.0, strokeWeight: 2, map: map });
                }
                flightPath = polylinesOnMap[currentUserId]; // Reference for editing
                flightPath.setOptions({ path: [], strokeColor: currentUserColor, map: map }); // Clear path, set color, ensure visible
                togglePathButton.textContent = 'End Path'; togglePathButton.classList.add('active');
                console.log("Entered Connect Mode.");
            } else { // Exiting connect mode
                togglePathButton.textContent = 'Start Path'; togglePathButton.classList.remove('active');
                console.log("Exited Connect Mode. Saving path sequence...");
                saveRouteSequence();
                flightPath = null; // Clear editing reference
            }
        });
        console.log("Path Button listener added.");
    } else { console.error("Path toggle button missing from HTML or ID mismatch."); }

    // Add map background click listener
    map.addListener('click', function(event) { handleMapClickToAddPoint(event.latLng); });
    console.log("Map click listener added.");

} // --- End of initMap function ---


// --- Authentication Functions ---
function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    console.log("Attempting Sign In...");
    if (!auth) { console.error("Auth instance NA."); return; }
    auth.signInWithPopup(provider).catch((error) => { console.error("Sign-In Error:", error); alert(`Sign-in failed: ${error.message}`); });
}
function signOutUser() {
    console.log("Attempting Sign Out...");
    if (!auth) { console.error("Auth instance NA."); return; }
    auth.signOut().catch((error) => { console.error("Sign-Out Error:", error); alert(`Sign-out failed: ${error.message}`); });
}

// --- UI Update Functions ---
function updateAuthUI(user) {
    // This function correctly showed/hid elements based on previous DEBUG logs
    // No DEBUG logs included in this clean version
    const signInButton = document.getElementById('sign-in-button');
    const signOutButton = document.getElementById('sign-out-button');
    const userInfoSpan = document.getElementById('user-info');
    const userNameSpan = document.getElementById('user-name');
    const togglePathButton = document.getElementById('toggle-path-button');

    if (user) { // Logic for logged-in user
        if (userInfoSpan) userInfoSpan.style.display = 'inline';
        if (userNameSpan) userNameSpan.textContent = user.displayName || user.email;
        if (signInButton) signInButton.style.display = 'none';
        if (signOutButton) signOutButton.style.display = 'inline';
        if (togglePathButton) togglePathButton.style.display = 'inline';
    } else { // Logic for logged-out user
        if (userInfoSpan) userInfoSpan.style.display = 'none';
        if (userNameSpan) userNameSpan.textContent = '';
        if (signInButton) signInButton.style.display = 'inline';
        if (signOutButton) signOutButton.style.display = 'none';
        if (togglePathButton) togglePathButton.style.display = 'none';
    }
}

// --- Firestore Interaction & Map Update Functions ---

function listenForAllPaths() {
    if (!db) { console.error("DB not ready for path listener."); return; }
    console.log("Setting up listener for ALL paths...");
    const pathsQuery = db.collection(PATH_COLLECTION);
    if (allPathsListener) { allPathsListener(); } // Unsubscribe previous

    allPathsListener = pathsQuery.onSnapshot((querySnapshot) => {
        console.log(`Paths snapshot: ${querySnapshot.size} docs.`);
        let currentPolylineIds = {}; let usersFromPaths = {};
        querySnapshot.forEach((docSnapshot) => {
            const pathData = docSnapshot.data(); const pathUserId = pathData.userId; const pathDocId = docSnapshot.id;
            if (pathUserId && pathData.sequence && Array.isArray(pathData.sequence)) {
                if (!displayedUsers[pathUserId]) { displayedUsers[pathUserId] = { displayName: pathData.displayName || pathUserId, color: getUserColor(pathUserId), isVisible: true }; }
                else { if (!displayedUsers[pathUserId].displayName || displayedUsers[pathUserId].displayName === pathUserId) displayedUsers[pathUserId].displayName = pathData.displayName || pathUserId; } // Update display name if needed
                usersFromPaths[pathUserId] = true;
                const userIsVisible = displayedUsers[pathUserId].isVisible; const userColor = displayedUsers[pathUserId].color;
                const pathLatLngs = pathData.sequence.map(coords => new google.maps.LatLng(coords.lat, coords.lng));
                if (polylinesOnMap[pathUserId]) { // Update existing
                    polylinesOnMap[pathUserId].setOptions({ path: pathLatLngs, strokeColor: userColor, map: userIsVisible ? map : null });
                } else { // Create new
                    polylinesOnMap[pathUserId] = new google.maps.Polyline({ path: pathLatLngs, geodesic: true, strokeColor: userColor, strokeOpacity: 1.0, strokeWeight: 2, map: userIsVisible ? map : null });
                }
                currentPolylineIds[pathUserId] = true;
                if(isConnectMode && pathUserId === currentUserId) { flightPath = polylinesOnMap[currentUserId]; }
            } else { console.warn("Invalid path data found:", pathDocId); }
        }); // End forEach doc
        // Remove stale polylines
        for (const userId in polylinesOnMap) { if (!currentPolylineIds[userId]) { polylinesOnMap[userId].setMap(null); delete polylinesOnMap[userId]; } }
        console.log("Finished processing path snapshot.");
        updateLegend();
    }, (error) => { console.error("Error listening to paths collection:", error); });
}


function listenForPointChanges() {
    if (!db) { console.error("DB not ready for point listener."); return; }
    console.log("Setting up listener for ALL points...");
    const pointsQuery = db.collection(POINTS_COLLECTION);
    if (pointsListener) { pointsListener(); }
    pointsListener = pointsQuery.onSnapshot((querySnapshot) => {
        console.log(`Points snapshot: Processing ${querySnapshot.size} points.`);
        let usersFromPoints = {};
        // First pass: Collect/update user info from points data
        querySnapshot.forEach((doc) => {
             const pointData = doc.data(); const userId = pointData.userId;
             if (userId) {
                 const displayName = pointData.displayName || userId; const color = pointData.color || getUserColor(userId);
                 if (!displayedUsers[userId]) { displayedUsers[userId] = { displayName: displayName, color: color, isVisible: true }; }
                 else { if (!displayedUsers[userId].displayName || displayedUsers[userId].displayName === userId) displayedUsers[userId].displayName = displayName; if (!displayedUsers[userId].color) displayedUsers[userId].color = color; if (displayedUsers[userId].isVisible === undefined) displayedUsers[userId].isVisible = true; }
                 usersFromPoints[userId] = true;
             }
        });
        // Second pass: Redraw visible markers
        clearAllMarkers(); markersOnMap = {};
        querySnapshot.forEach((doc) => {
            const pointData = doc.data(); const pointId = doc.id;
            if (pointData.lat && pointData.lng && pointData.userId) {
                const userId = pointData.userId;
                const userIsVisible = displayedUsers[userId]?.isVisible ?? true; // Check visibility state
                if (userIsVisible) { // Only draw if visible
                    const latLng = new google.maps.LatLng(pointData.lat, pointData.lng);
                    const markerColor = displayedUsers[userId].color; const displayName = displayedUsers[userId].displayName;
                    const marker = new google.maps.Marker({ position: latLng, map: map, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: markerColor, fillOpacity: 0.9, strokeWeight: 1, strokeColor: '#000000' } });
                    marker.firestoreId = pointId; marker.note = pointData.note || ""; marker.userId = userId; marker.color = markerColor; marker.displayName = displayName;
                    addListenersToMarker(marker); markersOnMap[pointId] = marker;
                }
            } else { console.warn("Snapshot skipping invalid point data:", pointId, pointData); }
        });
        console.log("Finished updating map from points snapshot.");
        updateLegend(); // Update the legend UI
        redrawVisiblePolylines(); // Ensure polyline visibility matches legend
    }, (error) => { console.error("Error listening to points collection:", error); });
}

function redrawVisiblePolylines() {
    console.log("Updating polyline visibility based on legend state.");
     for (const userId in polylinesOnMap) {
        if (polylinesOnMap.hasOwnProperty(userId)) {
             const userIsVisible = displayedUsers[userId] ? displayedUsers[userId].isVisible : true; // Default to visible if user somehow missing from legend
             polylinesOnMap[userId].setMap(userIsVisible ? map : null);
        }
    }
}

function saveRouteSequence() {
    if (!db || !currentUserId || !auth.currentUser) { console.error("DB, User ID or Auth User not available for saving route."); return; }
    const sequenceToSave = routeSequence.map(latLng => ({ lat: latLng.lat(), lng: latLng.lng() }));
    const pathDocRef = db.collection(PATH_COLLECTION).doc(`${currentUserId}_route`);
    console.log(`Saving route sequence (${sequenceToSave.length} points) for user ${currentUserId}`);
    pathDocRef.set({ sequence: sequenceToSave, userId: currentUserId, displayName: auth.currentUser.displayName || "Unknown" })
    .then(() => { console.log("Route sequence successfully saved!"); })
    .catch((error) => { console.error("Error saving route sequence: ", error); });
}

// --- Legend and Visibility Functions ---

function updateLegend() {
    const legendList = document.getElementById('legend-list');
    if (!legendList) return;
    const scrollY = window.scrollY; const legendScrollTop = legendList.parentElement.scrollTop;
    legendList.innerHTML = ''; // Clear items
    const sortedUserIds = Object.keys(displayedUsers).sort((a, b) => { if (a === currentUserId) return -1; if (b === currentUserId) return 1; return displayedUsers[a].displayName.localeCompare(displayedUsers[b].displayName); });
    console.log("Updating legend for users:", sortedUserIds);
    sortedUserIds.forEach(userId => {
        const userData = displayedUsers[userId]; const li = document.createElement('li');
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = `legend-chk-${userId}`; checkbox.checked = userData.isVisible; checkbox.dataset.userId = userId; checkbox.addEventListener('change', handleLegendCheckboxChange);
        const label = document.createElement('label'); label.htmlFor = checkbox.id;
        const swatch = document.createElement('span'); swatch.className = 'color-swatch'; swatch.style.backgroundColor = userData.color;
        const nameSpan = document.createElement('span'); nameSpan.textContent = userData.displayName + (userId === currentUserId ? " (You)" : "");
        label.appendChild(swatch); label.appendChild(nameSpan); li.appendChild(checkbox); li.appendChild(label); legendList.appendChild(li);
    });
     legendList.parentElement.scrollTop = legendScrollTop; window.scrollTo(0, scrollY);
}

function handleLegendCheckboxChange(event) {
    const checkbox = event.target; const userId = checkbox.dataset.userId;
    if (displayedUsers[userId]) {
        displayedUsers[userId].isVisible = checkbox.checked;
        console.log(`Toggled visibility for ${userId} to ${displayedUsers[userId].isVisible}`);
        updateVisibilityForUser(userId, displayedUsers[userId].isVisible);
    }
}

function updateVisibilityForUser(userId, isVisible) {
    const newMap = isVisible ? map : null;
    // Update markers
    for (const markerId in markersOnMap) { if (markersOnMap.hasOwnProperty(markerId) && markersOnMap[markerId].userId === userId) { markersOnMap[markerId].setMap(newMap); } }
    // Update polyline
    if (polylinesOnMap[userId]) { polylinesOnMap[userId].setMap(newMap); }
    console.log(`Set visibility for user ${userId} objects to ${isVisible}`);
}

// --- Map/Marker Interaction Functions ---

function addListenersToMarker(marker) {
    marker.addListener('click', function() { handleMarkerLeftClick(marker); });
    marker.addListener('rightclick', function() { handleMarkerRightClick(marker); });
}

function handleMarkerLeftClick(marker) {
    if (isConnectMode) { handleMarkerClickForPath(marker); }
    else {
        const currentNote = marker.note || ""; const markerId = marker.firestoreId;
        const markerOwnerName = marker.displayName || marker.userId || 'Unknown';
        const markerColor = marker.color || '#CCCCCC';
        if (!markerId) { console.error("Marker missing Firestore ID."); return; }
        const safeNote = document.createElement('textarea'); safeNote.textContent = currentNote;
        const infoWindowContent = `
         <div class="infowindow-content">
             <small>Owner: ${markerOwnerName} <span style="display:inline-block; width:10px; height:10px; background-color:${markerColor}; border-radius:50%; margin-left:5px;"></span></small><br>
             <strong>Notes:</strong><br>
             <textarea id="note-input-${markerId}" rows="4" cols="30">${safeNote.innerHTML}</textarea><br>
             <button onclick="saveNote('${markerId}')">Save Note</button>
         </div>`;
        infoWindow.setContent(infoWindowContent);
        infoWindow.open({ anchor: marker, map: map });
    }
}

function handleMapClickToAddPoint(clickedLatLng) {
    if (!currentUserId || !db || !auth.currentUser) { alert("Please sign in to add points."); return; }
    console.log(`Map clicked! Adding point by user: ${currentUserId}`);
    const userColor = getUserColor(currentUserId);
    const newPointData = {
        lat: clickedLatLng.lat(), lng: clickedLatLng.lng(), note: "",
        userId: currentUserId, color: userColor,
        displayName: auth.currentUser.displayName || "Unknown",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection(POINTS_COLLECTION).add(newPointData)
        .then((docRef) => { console.log("Point added (ID:", docRef.id, "). Listener will update map."); })
        .catch((error) => { console.error("Error adding point: ", error); });
}

function handleMarkerClickForPath(clickedMarker) {
    if (!currentUserId) return;
    console.log("Marker clicked in Connect Mode - adding to route seq.");
    const pointLatLng = clickedMarker.getPosition();
    if (pointLatLng) {
        routeSequence.push(pointLatLng);
        // Update the polyline currently being edited (referenced by flightPath)
        if(flightPath) flightPath.setPath(routeSequence);
        else console.error("flightPath reference not set in Connect Mode");
        console.log("Route sequence updated visually.");
    } else { console.error("Could not get LatLng from clicked marker!"); }
}

function handleMarkerRightClick(markerToRemove) {
    const docId = markerToRemove.firestoreId; const markerUserId = markerToRemove.userId;
    console.log(`Attempting delete for ID: ${docId}, Owner: ${markerUserId}`);
    const db = window.db;
    if (!docId || !db) { console.error("Cannot delete: Missing ID or DB."); markerToRemove.setMap(null); return; }
    if (markerUserId !== currentUserId) { alert("You can only delete markers you created."); return; }
    const latLngToRemove = markerToRemove.getPosition();

    db.collection(POINTS_COLLECTION).doc(docId).delete()
        .then(() => {
            console.log("Point deleted from Firestore:", docId);
            // Listener handles visual marker removal
            if (latLngToRemove) { // Update path sequence if needed
                const routeIndex = routeSequence.findIndex(latLng => latLng.equals(latLngToRemove));
                if (routeIndex > -1) {
                    routeSequence.splice(routeIndex, 1);
                    console.log("Point removed from runtime routeSequence.");
                    // Update visual immediately for responsiveness before listener potentially runs
                    if (polylinesOnMap[currentUserId]) {
                         polylinesOnMap[currentUserId].setPath(routeSequence);
                    }
                    saveRouteSequence(); // Save updated sequence
                }
            }
        })
        .catch((error) => { console.error("Error deleting point from Firestore: ", error); });
}

function saveNote(docId) {
    console.log(`Attempting save note for ID: ${docId}`);
    const textarea = document.getElementById(`note-input-${docId}`); const db = window.db;
    const marker = markersOnMap[docId];
    if (!docId || !textarea || !db) { console.error(`Error saving note: Missing data`); return; }
    if (marker && marker.userId !== currentUserId) { alert("You can only save notes for your own markers."); infoWindow.close(); return; }
    const newNote = textarea.value;
    db.collection(POINTS_COLLECTION).doc(docId).update({ note: newNote })
    .then(() => { console.log(`Note updated for ID: ${docId}`); if (marker) { marker.note = newNote; } infoWindow.close(); })
    .catch((error) => { console.error("Error updating note: ", error); });
}

function clearAllMarkers() {
    console.log("Clearing all markers from map.");
    for (const id in markersOnMap) { if (markersOnMap.hasOwnProperty(id)) { markersOnMap[id].setMap(null); } }
    markersOnMap = {};
}

function clearAllPolylines() {
    console.log("Clearing all polylines from map.");
    for (const userId in polylinesOnMap) { if (polylinesOnMap.hasOwnProperty(userId)) { polylinesOnMap[userId].setMap(null); } }
    polylinesOnMap = {};
}

// --- END OF app.js ---