'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr';
import './../styles.css'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function DashboardPage() {
  const router = useRouter();
  
  // State for selected filter values
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  
  // State for selected filter values
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedFaculty, setSelectedFaculty] = useState('all');
  const [searchModules, setSearchModules] = useState('');

  // Hardcoded options for dropdowns
  const countries = ['all', 'Australia', 'Austria', 'Belgium', 'Canada', 'China', 'Denmark', 'Finland', 'France', 'Germany', 'Hong Kong', 'Ireland', 'Italy', 'Japan', 'Netherlands', 'New Zealand', 'Norway', 'Poland', 'Scotland', 'Singapore', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'Taiwan', 'Thailand', 'Turkey', 'UK', 'USA'];
  const faculties = ['all', 'College of Design and Engineering', 'Faculty of Arts and Social Sciences', 'Faculty of Dentistry', 'Faculty of Law', 'Faculty of Science', 'School of Business', 'School of Computing', 'Yong Loo Lin School of Medicine', 'Yong Siew Toh Conservatory of Music'];

  const fetchData = async () => {
    setIsLoading(true);
    setSearchResults([]);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          country: selectedCountry,
          faculty: selectedFaculty,
          modules: searchModules.trim()
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`HTTP error! Status: ${response.status} - ${errorData.message || 'Unknown error'}`);
      }

      const data = await response.json();
      if (data.tableData && Array.isArray(data.tableData) && data.tableData.length > 0) {
        setSearchResults(data.tableData);
        setMessage(null);
      } else {
        setSearchResults([]);
        setMessage("No exchange programs found matching your criteria.");
      }
    } catch (error: any) {
      console.error("Error fetching data:", error);
      setSearchResults([]);
      setMessage("Failed to load programs. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyFilters = () => {
    fetchData();
  };

  // Fetch data on initial load
  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="container">
      <header>
        <h1>NUSMapper Dashboard</h1>
          <div className="user-controls">
            <button 
              className="share-btn" 
              onClick={async () => {
                const { error } = await supabase.auth.signOut();
                if (error) {
                  console.error('Logout error:', error);
                  alert('Logout failed');
                } else {
                  router.push('/');
                }
              }}
            >
              Logout
            </button>
          </div>
      </header>

      <main>
        <div className="filter-box">
          <div className="filter-grid">
            {/* Country Filter */}
            <div className="filter-group">
              <label className="filter-label">
                Country
                <select
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="filter-input"
                >
                  <option value="all">All Countries</option>
                  {countries.filter(c => c !== 'all').map(country => (
                    <option key={country} value={country}>{country}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Faculty Filter */}
            <div className="filter-group">
              <label className="filter-label">
                NUS Home Faculty
                <select
                  value={selectedFaculty}
                  onChange={(e) => setSelectedFaculty(e.target.value)}
                  className="filter-input"
                >
                  <option value="all">Any Faculty</option>
                  {faculties.filter(d => d !== 'all').map(faculty => (
                    <option key={faculty} value={faculty}>{faculty}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Modules Text Input */}
            <div className="filter-group">
              <label className="filter-label">
                Module Codes
                <input
                  type="text"
                  placeholder="e.g. CS1010"
                  value={searchModules}
                  onChange={(e) => setSearchModules(e.target.value)}
                  className="filter-input"
                />
              </label>
            </div>
          </div>

          <button 
            onClick={handleApplyFilters}
            className="filter-button"
          >
            Apply Filters
          </button>
        </div>

        {/* Search Results Display */}
        <div className="search-results-display">
          {isLoading && <p>Loading exchange programs...</p>}

          {!isLoading && message && (
              <p className="dashboard-error-message">{message}</p>
          )}

          {!isLoading && !message && searchResults.length === 0 && (
              <p>Apply filters to find exchange opportunities.</p>
          )}

          {!isLoading && Array.isArray(searchResults) && searchResults.length > 0 && (
              <div className="table-container">
                  <table>
                      <thead>
                          <tr>
                              <th>Country</th>
                              <th>Partner University</th>
                              <th>Partner University Module</th>
                              <th>NUS Home Faculty</th>
                              <th>NUS Module</th>
                          </tr>
                      </thead>
                    <tbody>
                      {searchResults.map((program, index) => (
                        <tr key={program.id || index}>
                          <td>{program.country}</td>
                          <td>{program.partner_university}</td>
                          <td>{program.partner_module_code}</td>
                          <td>{program.nus_faculty}</td>
                          <td>{program.nus_module_code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              </div>
          )}
        </div>
      </main>
    </div>
  )
}
