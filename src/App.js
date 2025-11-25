import React, { useState, useEffect } from 'react';
import { Search, MapPin, Loader2, AlertCircle, Download, Map, Home } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import L from 'leaflet';
import logo from './Assets/pah_logos.png';

// Fix missing marker icons in React Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom hospice icon
const hospiceIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const boroughToRegion = {
  'Elmbridge': 'Surrey Downs',
  'Epsom and Ewell': 'Surrey Downs',
  'Kingston upon Thames': 'Kingston upon Thames',
  'Mole Valley': 'Surrey Downs',
  'Reigate and Banstead': 'Surrey Downs',
  'Richmond upon Thames': 'Richmond upon Thames',
  'Runnymede': 'North West Surrey',
  'Spelthorne': 'North West Surrey',
};

const regionColors = {
  'Kingston upon Thames': '#8764B8',
  'Richmond upon Thames': '#3982a3ff',
  'Surrey Downs': '#f39c12',
  'North West Surrey': '#27ae60',
};

function App() {
  const [mode, setMode] = useState('search');
  const [postcode, setPostcode] = useState('');
  const [radius, setRadius] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchInfo, setSearchInfo] = useState(null);
  const [allPostcodes, setAllPostcodes] = useState([]);
  const [hospices, setHospices] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [submittedPostcode, setSubmittedPostcode] = useState('');

  // Map mode states
  const [searchedLocation, setSearchedLocation] = useState(null);
  const [boroughData, setBoroughData] = useState(null);
  const [currentRegion, setCurrentRegion] = useState(null);
  const [nearestHospices, setNearestHospices] = useState([]);
  const [isOutsideCareArea, setIsOutsideCareArea] = useState(false);
  const [mapCenter, setMapCenter] = useState([51.4, -0.3]);
  const [mapZoom, setMapZoom] = useState(11);

  // Load CSV data - postcodes and hospices
  useEffect(() => {
    const loadData = async () => {
      try {
        setDataLoading(true);

        // Load postcode data
        const postcodeResponse = await fetch(`${process.env.PUBLIC_URL}/data/combined_df_data.csv`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });

        if (!postcodeResponse.ok) {
          throw new Error(`Failed to load postcodes: ${postcodeResponse.status}`);
        }

        const postcodeCsvText = await postcodeResponse.text();
        const postcodeLines = postcodeCsvText.trim().split('\n');
        const postcodeHeaders = postcodeLines[0].split(',').map(h => h.trim());

        const postcodeData = postcodeLines.slice(1).map(line => {
          const values = line.split(',');
          const row = {};
          postcodeHeaders.forEach((header, index) => {
            const value = values[index]?.trim();
            if (header === 'latitude' || header === 'longitude') {
              row[header] = parseFloat(value);
            } else {
              row[header] = value;
            }
          });
          return row;
        });

        setAllPostcodes(postcodeData);

        // Load hospice data
        const hospiceResponse = await fetch(`${process.env.PUBLIC_URL}/data/hospices.csv`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });

        if (!hospiceResponse.ok) {
          throw new Error(`Failed to load hospices: ${hospiceResponse.status}`);
        }

        const hospiceCsvText = await hospiceResponse.text();
        const hospiceLines = hospiceCsvText.trim().split('\n');
        const hospiceHeaders = hospiceLines[0].split(',').map(h => h.trim());

        const hospiceData = hospiceLines.slice(1).map(line => {
          const values = line.split(',');
          const row = {};
          hospiceHeaders.forEach((header, index) => {
            const value = values[index]?.trim();
            if (header === 'latitude' || header === 'longitude') {
              row[header] = parseFloat(value);
            } else {
              row[header] = value;
            }
          });
          return row;
        });

        setHospices(hospiceData);
        setDataLoading(false);
      } catch (err) {
        console.error('Error loading data:', err);
        setError(`Failed to load data: ${err.message}. Please ensure CSV files are in the public/data folder.`);
        setDataLoading(false);
      }
    };

    loadData();
  }, []);

  // Load GeoJSON data
  useEffect(() => {
    fetch(`${process.env.PUBLIC_URL}/data/london-boroughs.geojson`)
      .then((res) => res.json())
      .then((data) => {
        const filtered = data.features.filter((f) => {
          const name = f.properties.NAME || f.properties.name || f.properties.LAD25NM;
          return name in boroughToRegion;
        });
        setBoroughData({ type: 'FeatureCollection', features: filtered });
      })
      .catch((err) => console.error('Error loading GeoJSON:', err));
  }, []);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const toRad = (deg) => (deg * Math.PI) / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const searchPostcodes = () => {
    if (!postcode.trim()) {
      setError('Please enter a postcode');
      return;
    }

    const center = allPostcodes.find((p) =>
      p.postcode?.toUpperCase().replace(/\s/g, '') === postcode.toUpperCase().replace(/\s/g, '')
    );

    if (!center) {
      setError('Postcode not found in dataset');
      return;
    }

    if (!center.latitude || !center.longitude) {
      setError('Center postcode missing coordinates');
      return;
    }

    if (!radius || radius <= 0) {
      setError('Please enter a valid radius');
      return;
    }

    setLoading(true);
    setError('');
    setResults([]);
    setSearchInfo(null);

    const radiusKm = parseFloat(radius);
    const nearby = allPostcodes
      .map((p) => {
        if (!p.latitude || !p.longitude) return null;
        const distance = calculateDistance(center.latitude, center.longitude, p.latitude, p.longitude);
        return { ...p, distance_km: distance };
      })
      .filter((p) => p !== null && p.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km);

    setResults(nearby);
    setSearchInfo({
      center: center.postcode,
      centerLat: center.latitude,
      centerLon: center.longitude,
      radius,
      count: nearby.length,
    });

    setLoading(false);
  };

  const handlePostcodeSearchForMap = async () => {
    if (!postcode.trim()) {
      setError('Please enter a postcode');
      return;
    }

    setError('');
    setLoading(true);
    setNearestHospices([]);
    setIsOutsideCareArea(false);

    let pc = postcode.trim().toUpperCase();

    // If no space, insert one before last 3 characters
    if (!pc.includes(" ") && pc.length > 3) {
      pc = pc.slice(0, -3) + " " + pc.slice(-3);
    }

    setSubmittedPostcode(pc.trim());

    try {
      const response = await axios.get(`https://api.postcodes.io/postcodes/${postcode.trim()}`);
      const { latitude, longitude, admin_district } = response.data.result;

      setSearchedLocation({ latitude, longitude });
      setMapCenter([latitude, longitude]);
      setMapZoom(13);

      // Check if in care area
      const region = boroughToRegion[admin_district];
      const outsideCareArea = !region;

      setIsOutsideCareArea(outsideCareArea);
      setCurrentRegion({ borough: admin_district, region: region || 'Outside Care Area' });

      // If outside care area, find nearest 5 hospices
      if (outsideCareArea) {
        const hospicesWithDistance = hospices
          .filter(h => h.latitude && h.longitude) // Ensure valid coordinates
          .map(h => ({
            ...h,
            distance: calculateDistance(latitude, longitude, h.latitude, h.longitude)
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 5);

        setNearestHospices(hospicesWithDistance);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching postcode data:', error);
      setError('Postcode not found or invalid. Please check and try again.');
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      if (mode === 'search') {
        searchPostcodes();
      } else {
        handlePostcodeSearchForMap();
      }
    }
  };

  const downloadCSV = () => {
    if (results.length === 0) {
      setError('No data to download');
      return;
    }

    const headers = ['postcode', 'latitude', 'longitude', 'distance_km'];
    const csvContent = [
      headers.join(','),
      ...results.map((p) => `${p.postcode},${p.latitude},${p.longitude},${p.distance_km.toFixed(4)}`),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `postcodes_within_${radius}km_of_${postcode}.csv`;
    link.click();
  };

  const boroughStyle = (feature) => {
    const name = feature.properties.NAME || feature.properties.name || feature.properties.LAD25NM;
    const region = boroughToRegion[name] || 'Outside';
    return {
      color: regionColors[region] || '#999',
      weight: 2,
      fillOpacity: 0.4,
    };
  };

  if (dataLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-700 text-lg">Loading data...</p>
          <p className="text-gray-500 text-sm mt-2">Please wait while we load postcodes and hospice information</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-6">
          <div className="flex items-center justify-between mb-6 max-w-6xl mx-auto">
            <h2 className="text-4xl font-bold text-blue-900">Postcode Explorer</h2>
            <img
              src={logo}
              alt="Company Logo"
              className="w-38 h-16 object-contain"
            />
          </div>
        </div>

        {/* Mode Toggle Buttons */}
        <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
          <div className="flex gap-4">
            <button
              onClick={() => {
                setMode('search');
                setError('');
                setNearestHospices([]);
                setIsOutsideCareArea(false);
              }}
              className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-semibold transition ${mode === 'search'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              <Search className="w-5 h-5" />
              Find Nearby Postcodes
            </button>
            <button
              onClick={() => {
                setMode('map');
                setError('');
                setResults([]);
                setSearchInfo(null);
              }}
              className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-semibold transition ${mode === 'map'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              <Map className="w-5 h-5" />
              View Map & Find Hospices
            </button>
          </div>
        </div>

        {/* Search Mode */}
        {mode === 'search' && (
          <>
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      UK Postcode
                    </label>
                    <input
                      type="text"
                      value={postcode}
                      onChange={(e) => setPostcode(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="e.g., KT22 8DN"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Radius (km)
                    </label>
                    <input
                      type="number"
                      value={radius}
                      onChange={(e) => setRadius(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="e.g., 8.04672"
                      min="0.1"
                      step="0.1"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  onClick={searchPostcodes}
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md flex items-center justify-center gap-2 hover:bg-blue-700 transition disabled:bg-blue-400"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {loading ? 'Searching...' : 'Search Postcodes'}
                </button>
              </div>
            </div>

            {searchInfo && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-green-800">
                    Found <strong>{searchInfo.count}</strong> postcodes within{' '}
                    <strong>{searchInfo.radius} km</strong> of{' '}
                    <strong>{searchInfo.center}</strong>
                  </p>
                  <button
                    onClick={downloadCSV}
                    className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download CSV
                  </button>
                </div>
                <p className="text-xs text-green-700">
                  Center: {searchInfo.centerLat.toFixed(6)}, {searchInfo.centerLon.toFixed(6)}
                </p>
              </div>
            )}

            {results.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg">
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                    <MapPin className="w-5 h-5" />
                    Results ({results.length} postcodes)
                  </h2>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <div className="grid gap-2 p-4">
                    {results.map((p, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                      >
                        <div>
                          <span className="font-mono text-lg font-semibold text-blue-600">
                            {p.postcode}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-gray-700">
                            {p.distance_km.toFixed(2)} km
                          </span>
                          <p className="text-xs text-gray-500">
                            {p.latitude?.toFixed(4)}, {p.longitude?.toFixed(4)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Map Mode */}
        {mode === 'map' && (
          <>
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    UK Postcode
                  </label>
                  <input
                    type="text"
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="e.g., KT22 8DN"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <button
                  onClick={handlePostcodeSearchForMap}
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md flex items-center justify-center gap-2 hover:bg-blue-700 transition disabled:bg-blue-400"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                  {loading ? 'Locating...' : 'Check Location & Find Hospices'}
                </button>
              </div>
            </div>

            {currentRegion && (
              <div className={`${isOutsideCareArea ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'} border rounded-lg p-4 mb-6`}>
                <p className={isOutsideCareArea ? 'text-orange-800' : 'text-blue-800'}>
                  <strong>{submittedPostcode.toUpperCase()}</strong> is in <strong>{currentRegion.borough}</strong>
                </p>
                <p className={`text-sm mt-1 ${isOutsideCareArea ? 'text-orange-700' : 'text-blue-700'}`}>
                  Care Area: <strong>{currentRegion.region}</strong>
                </p>
                {isOutsideCareArea && (
                  <p className="text-sm text-orange-700 mt-2 font-semibold">
                    ⚠ This postcode is outside our care area. Here are the 5 nearest hospices:
                  </p>
                )}
              </div>
            )}

            {/* Nearest Hospices List */}
            {nearestHospices.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg mb-6">
                <div className="p-4 border-b border-gray-200 bg-orange-50">
                  <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                    <Home className="w-5 h-5 text-orange-600" />
                    5 Nearest Hospices
                  </h2>
                </div>
                <div className="p-4">
                  <div className="space-y-3">
                    {nearestHospices.map((hospice, index) => (
                      <div
                        key={index}
                        className="p-4 bg-gradient-to-r from-orange-50 to-white rounded-lg border border-orange-200 hover:shadow-md transition"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-semibold text-lg text-gray-900">{hospice.Name}</h3>
                          <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium">
                            {hospice.distance.toFixed(2)} km
                          </span>
                        </div>
                        <div className="text-gray-600 space-y-1">
                          <p className="text-sm">{hospice.A1}</p>
                          <p className="text-sm">
                            {hospice.A2}
                            {hospice.A2 && hospice.A3 ? ", " : ""}
                            {hospice.A3}
                          </p>
                          <p className="text-sm font-mono text-blue-600">{hospice.postcode}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Map with Hospice Markers */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div className="h-[600px] relative">
                <MapContainer
                  center={mapCenter}
                  zoom={mapZoom}
                  style={{ height: '100%', width: '100%' }}
                  key={`${mapCenter[0]}-${mapCenter[1]}-${mapZoom}`}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  />

                  {boroughData && (
                    <GeoJSON
                      data={boroughData}
                      style={boroughStyle}
                      onEachFeature={(feature, layer) => {
                        const name = feature.properties.NAME || feature.properties.name || feature.properties.LAD25NM;
                        const region = boroughToRegion[name] || 'Outside';
                        layer.bindPopup(`<strong>${name}</strong><br/>Care Area: ${region}`);
                      }}
                    />
                  )}

                  {searchedLocation && (
                    <Marker position={[searchedLocation.latitude, searchedLocation.longitude]}>
                      <Popup>
                        <strong>{submittedPostcode.toUpperCase()}</strong>
                        {currentRegion && (
                          <>
                            <br />{currentRegion.borough}
                            <br />Care Area: {currentRegion.region}
                          </>
                        )}
                      </Popup>
                    </Marker>
                  )}

                  {nearestHospices.map((hospice, index) => (
                    <Marker
                      key={index}
                      position={[hospice.latitude, hospice.longitude]}
                      icon={hospiceIcon}
                    >
                      <Popup>
                        <div className="text-sm">
                          <strong className="text-base">{hospice.Name}</strong>
                          <p className="mt-1">{hospice.A1}</p>
                          <p className="text-sm">
                            {hospice.A2}
                            {hospice.A2 && hospice.A3 ? ", " : ""}
                            {hospice.A3}
                          </p>
                          <p className="font-mono text-blue-600 mt-1">{hospice.postcode}</p>
                          <p className="text-orange-600 font-semibold mt-2">
                            {hospice.distance.toFixed(2)} km away
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>

              {/* Legend */}
              <div className="p-4 border-t border-gray-200 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Legend:</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {Object.entries(regionColors).map(([region, color]) => (
                    <div key={region} className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: color }}></div>
                      <span className="text-xs text-gray-700">{region}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-5 bg-red-500 rounded-sm"></div>
                    <span className="text-xs text-gray-700">Hospice</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-700">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;