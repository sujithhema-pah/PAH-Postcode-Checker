import React, { useState, useEffect } from 'react';
import { Search, MapPin, Loader2, AlertCircle, Download, Map } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import axios from "axios";
import L from 'leaflet';

// Fix missing marker icons in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
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
  const [mode, setMode] = useState('search'); // 'search' or 'map'
  const [postcode, setPostcode] = useState('');
  const [radius, setRadius] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchInfo, setSearchInfo] = useState(null);
  const [allPostcodes, setAllPostcodes] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  
  // Map mode states
  const [markerPosition, setMarkerPosition] = useState(null);
  const [boroughData, setBoroughData] = useState(null);
  const [currentRegion, setCurrentRegion] = useState(null);

  // Load CSV data
  useEffect(() => {
    const loadData = async () => {
      try {
        setDataLoading(true);
        const response = await fetch('/data/combined_df_data.csv', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        const lines = csvText.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        
        const data = lines.slice(1).map(line => {
          const values = line.split(',');
          const row = {};
          headers.forEach((header, index) => {
            const value = values[index]?.trim();
            if (header === 'latitude' || header === 'longitude') {
              row[header] = parseFloat(value);
            } else {
              row[header] = value;
            }
          });
          return row;
        });
        
        setAllPostcodes(data);
        setDataLoading(false);
      } catch (err) {
        console.error('Error loading CSV:', err);
        setError('Failed to load postcode data. Please ensure combined_df_data.csv is in the public folder.');
        setDataLoading(false);
      }
    };

    loadData();
  }, []);

  // Load GeoJSON data
  useEffect(() => {
    fetch('/data/london-boroughs.geojson')
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
    const R = 6371;
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
    if (!postcode) {
      setError('Please enter a postcode');
      return;
    }
    
    setError('');
    setLoading(true);
    
    try {
      const response = await axios.get(`https://api.postcodes.io/postcodes/${postcode}`);
      const { latitude, longitude, admin_district } = response.data.result;
      setMarkerPosition([latitude, longitude]);
      
      // Determine region
      const region = boroughToRegion[admin_district] || 'Outside';
      setCurrentRegion({ borough: admin_district, region });
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching postcode data:', error);
      setError('Postcode not found or invalid');
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
          <p className="text-gray-700 text-lg">Loading postcode data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">PAH Postcode Finder & Map</h1>
          <p className="text-gray-600">Search nearby postcodes or view regions on map</p>
          <p className="text-sm text-gray-500 mt-2">
            Loaded {allPostcodes.length.toLocaleString()} postcodes
          </p>
        </div>

        {/* Mode Toggle Buttons */}
        <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
          <div className="flex gap-4">
            <button
              onClick={() => { setMode('search'); setError(''); }}
              className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-semibold transition ${
                mode === 'search'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Search className="w-5 h-5" />
              Find Nearby Postcodes
            </button>
            <button
              onClick={() => { setMode('map'); setError(''); setResults([]); setSearchInfo(null); }}
              className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-semibold transition ${
                mode === 'map'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Map className="w-5 h-5" />
              View Map & Regions
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
                  {loading ? 'Locating...' : 'Show on Map'}
                </button>
              </div>
            </div>

            {currentRegion && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-blue-800">
                  <strong>{postcode.toUpperCase()}</strong> is in <strong>{currentRegion.borough}</strong>
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  Care Area: <strong>{currentRegion.region}</strong>
                </p>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div className="h-[600px] relative">
                <MapContainer
                  center={[51.4, -0.3]}
                  zoom={11}
                  style={{ height: '100%', width: '100%' }}
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

                  {markerPosition && (
                    <Marker position={markerPosition}>
                      <Popup>
                        <strong>{postcode.toUpperCase()}</strong>
                        {currentRegion && (
                          <>
                            <br/>{currentRegion.borough}
                            <br/>Care Area: {currentRegion.region}
                          </>
                        )}
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              </div>
              
              {/* Legend */}
              <div className="p-4 border-t border-gray-200 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Care Area Regions:</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(regionColors).map(([region, color]) => (
                    <div key={region} className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: color }}></div>
                      <span className="text-xs text-gray-700">{region}</span>
                    </div>
                  ))}
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