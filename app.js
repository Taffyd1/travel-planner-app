// --- CORRECTED CLEAN app.js ---

// Global variables
let pathPoints = [];      // Stores objects: { marker: markerObject, latLng: latLngObject } for ALL placed markers
let flightPath = null;    // Holds the google.maps.Polyline object
let map = null;           // Holds the google.maps.Map object
let routeSequence = [];   // Stores LatLng objects for the polyline path, in ORDER
let isConnectMode = false;// Tracks if we are defining the path

// Main initialization function called by Google Maps API callback
function initMap() {
    const mapCenter = { lat: 40.11, lng: -88.04 }; // Approx. Saint Joseph, IL
    const mapOptions = {
        zoom: 12,
        center: mapCenter,
        mapTypeId: 'roadmap'
    };

    const mapElement = document.getElementById('map');
    map = new google.maps.Map(mapElement, mapOptions); // Assign to global map variable
    console.log("Map initialized!");

    // Initialize the Polyline (initially empty)
    flightPath = new google.maps.Polyline({
        geodesic: true,
        strokeColor: '#FF0000',
        strokeOpacity: 1.0,
        strokeWeight: 2,
        map: map // Add the line object to the map
    });
    console.log("Polyline initialized.");

    // Add a LEFT-click listener to the MAP BACKGROUND
    map.addListener('click', function(event) {
        // When map background is clicked, add a new marker point
        handleMapClick(event.latLng);
    });
    console.log("Map click listener added.");

    // Get the button element we added in HTML
    const togglePathButton = document.getElementById('toggle-path-button');

    // Add click listener to the button
    togglePathButton.addEventListener('click', function() {
        // Toggle the mode flag
        isConnectMode = !isConnectMode;

        if (isConnectMode) {
            // --- Entering connect mode ---
            routeSequence = []; // Clear the previous route sequence
            flightPath.setPath(routeSequence); // Clear the visible polyline
            togglePathButton.textContent = 'End Path'; // Set button text
            togglePathButton.style.backgroundColor = '#dc3545'; // Optional: Change button color
            console.log("Entered Connect Mode. Click existing markers to define path.");
        } else {
            // --- Exiting connect mode ---
            togglePathButton.textContent = 'Start Path'; // Set button text back
            togglePathButton.style.backgroundColor = ''; // Optional: Reset button color
            console.log("Exited Connect Mode. Path sequence finalized.");
        }
    });
    console.log("Button listener added.");

} // --- End of initMap function ---


// Helper function to handle adding a new point/marker when MAP is clicked
function handleMapClick(clickedLatLng) {
    console.log(`Map clicked! Lat: ${clickedLatLng.lat()}, Lng: ${clickedLatLng.lng()}`);

    // Create a new marker at the clicked location
    const newMarker = new google.maps.Marker({
        position: clickedLatLng,
        map: map
    });
    console.log("New marker created.");

    // Add LEFT-click listener TO THE NEW MARKER
    newMarker.addListener('click', function() {
        if (isConnectMode) {
            handleMarkerClickForPath(newMarker);
        } else {
            console.log("Marker clicked, but not in Connect Mode.");
        }
    });

    // Add RIGHT-click listener TO THE NEW MARKER
    newMarker.addListener('rightclick', function() {
        handleMarkerRightClick(newMarker);
    });

    // Store the marker and its coordinates together in the main list
    pathPoints.push({ marker: newMarker, latLng: clickedLatLng });
    console.log("Point added to main pathPoints array.");
}


// Helper function to handle adding a marker TO THE ROUTE when clicked in Connect Mode
function handleMarkerClickForPath(clickedMarker) {
    console.log("Marker clicked in Connect Mode - adding to route.");

    // Find the corresponding point object to get its LatLng
    const pointObject = pathPoints.find(point => point.marker === clickedMarker);

    if (pointObject) {
        // Add the coordinate to our route sequence array
        routeSequence.push(pointObject.latLng);
        // Update the polyline on the map to use the new route sequence
        flightPath.setPath(routeSequence);
        console.log("Route sequence updated, polyline redrawn.");
    } else {
        console.error("Internal Error: Could not find clicked marker in pathPoints array!");
    }
}


// Helper function to handle removing a marker (via right-click)
function handleMarkerRightClick(markerToRemove) {
    console.log("Marker right-clicked, attempting removal.");

    // Find the point object *before* removing it, so we can get its LatLng
    const pointObjectToRemove = pathPoints.find(point => point.marker === markerToRemove);
    const latLngToRemove = pointObjectToRemove ? pointObjectToRemove.latLng : null;

    // Remove marker from map visually
    markerToRemove.setMap(null);

    // Find the index of the point object in our main array
    const index = pathPoints.findIndex(point => point.marker === markerToRemove);

    if (index > -1) {
        // Remove the object {marker, latLng} from the pathPoints array
        pathPoints.splice(index, 1);
        console.log("Point removed from main pathPoints array.");

        // Check and remove from routeSequence array if it exists there
        if (latLngToRemove) {
            const routeIndex = routeSequence.findIndex(latLng => latLng.equals(latLngToRemove));
            if (routeIndex > -1) {
                routeSequence.splice(routeIndex, 1);
                console.log("Point removed from routeSequence array.");
                // Update the polyline since the route changed
                flightPath.setPath(routeSequence);
                console.log("Polyline path updated after removal from route.");
            } else {
                 console.log("Marker was not in routeSequence, polyline unchanged.");
            }
        }
    } else {
        console.log("Error: Could not find marker in pathPoints array upon right-click.");
    }
}

// --- END OF CORRECTED CLEAN app.js ---