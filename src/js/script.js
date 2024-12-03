async function fetchItemNames() {
    const response = await fetch('https://bitmatemediator.net/game/v1/items');
    return response.json();
}

async function fetchPlayerData(playerName) {
    try {
        // If it's a wallet, first search for the player name
        if (playerName.startsWith('0x') && playerName.length === 42) {
            const playerInfo = await fetchPlayerBySearch(playerName);
            if (playerInfo && playerInfo.name) {
                playerName = playerInfo.name;
            } else {
                throw new Error('Player not found');
            }
        }

        // Search for the player stats using the player name
        const url = `https://bitmatemediator.net/game/v1/playerstats/?username=${playerName}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return { ...data, name: playerName };
    } catch (error) {
        console.error(`Error to fetch data for ${playerName}:`, error);
        return null;
    }
}

function getItemInfo(itemId) {
    return {
        name: itemNames[itemId] || `Item ${itemId}`,
        image: `https://storage.googleapis.com/apes-f984d.appspot.com/s-images/s-${itemId}.png`
    };
}

function getEnemyInfo(enemyId) {
    return {
        name: enemyNames[enemyId] || `Enemy ${enemyId}`,
        image: `https://storage.googleapis.com/apes-f984d.appspot.com/Enemies/${enemyNames[enemyId]}.png`
    };
}

async function fetchPlayerBySearch(searchTerm) {
    try {
        const response = await fetch(`https://bitmatemediator.net/highscore/v1/player/${searchTerm}`);
        if (!response.ok) {
            throw new Error('Player not found');
        }
        const data = await response.json();
        return {
            name: data.data.name
        };
    } catch (error) {
        return null;
    }
}

async function fetchAllPlayers() {
    let players = [];
    let page = 1;
    let hasMorePlayers = true;
    let totalPlayersBeforeFilter = 0;

    while (hasMorePlayers) {
        try {
            const response = await fetch(`https://bitmatemediator.net/game/v1/killstats?valueid=2&time=monthly&page=${page}&_=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            // If no more data, stop
            if (data.length === 0) {
                hasMorePlayers = false;
                continue;
            }
            
            totalPlayersBeforeFilter += data.length;
            
            // Filter only players with value >= 1
            const validPlayers = data.filter(player => player.value >= 1);
            //console.log(`Page ${page}: ${data.length} players, ${validPlayers.length} valid`);
            
            // If no valid players found in the page, stop
            if (validPlayers.length === 0) {
                hasMorePlayers = false;
                continue;
            }
            
            players = players.concat(validPlayers.map(player => ({ name: player.name })));
            page++;
            
        } catch (error) {
            console.error('Error fetching players:', error);
            hasMorePlayers = false;
        }
    }

    console.log('Total active players:', players.length);
    return players;
}

async function generateRanking(timePeriod = 'all_time') {
    let searchTerm = document.getElementById('player-search').value.trim();
    let players = [];
    let isNonMember = false;

    try {
        // If it's a wallet, first convert to player name
        if (searchTerm && searchTerm.startsWith('0x') && searchTerm.length === 42) {
            const response = await fetch(`https://bitmatemediator.net/highscore/v1/player/${searchTerm}`);
            if (!response.ok) {
                throw new Error('Player not found');
            }
            const data = await response.json();
            searchTerm = data.data.name;
        }

        // Fetching all active players
        const activePlayers = await fetchAllPlayers();

        if (searchTerm) {
            const player = await fetchPlayerBySearch(searchTerm);
            if (player) {
                isNonMember = !activePlayers.some(member => member.name === player.name);
                players = isNonMember ? [{ name: player.name }] : activePlayers;
            } else {
                throw new Error('Player not found');
            }
        } else {
            players = activePlayers;
        }

        // Fetching player data
        const playerData = await Promise.all(
            players.map(player => fetchPlayerData(player.name))
        );

        // Filtering only valid player data
        const validPlayerData = playerData.filter(data => data !== null);

        const categories = ['gathered', 'crafted', 'rewarded', 'kills'];
        const rankings = {};

        categories.forEach(category => {
            rankings[category] = {};
            
            validPlayerData.forEach(player => {
                if (!player) return;
                
                let categoryData;
                if (category === 'kills') {
                    categoryData = player.killcounts;
                } else {
                    categoryData = player[`items_${category}_counts`];
                }
                
                if (categoryData) {
                    Object.entries(categoryData).forEach(([itemId, counts]) => {
                        if (!rankings[category][itemId]) {
                            rankings[category][itemId] = [];
                        }
                        
                        const value = timePeriod === 'all_time' ? 
                            Number(counts.value || 0) : 
                            Number(counts[`value_${timePeriod}`] || 0);
                            
                        if (isNaN(value) || value < 0) {
                            console.error(`Invalid value for ${player.name} in ${category}:`, counts);
                            return;
                        }

                        const existingPlayer = rankings[category][itemId]
                            .find(p => p.name === player.name);
                            
                        if (!existingPlayer) {
                            rankings[category][itemId].push({
                                name: player.name,
                                count: value
                            });
                        }
                    });
                }
            });

            Object.keys(rankings[category]).forEach(itemId => {
                rankings[category][itemId].sort((a, b) => {
                    const diff = b.count - a.count;
                    return diff !== 0 ? diff : a.name.localeCompare(b.name);
                });
            });
        });

        return { 
            rankings, 
            isNonMember,
            searchTerm: searchTerm ? searchTerm : null 
        };
    } catch (error) {
        console.error('Error generating rankings:', error);
        throw error;
    }
}

async function updateRankingUI(rankingsData) {
    const { rankings, isNonMember, searchTerm } = rankingsData;
    const container = document.getElementById('ranking-container');
    container.innerHTML = '';

    const items = await fetchItemNames();
    const enemies = await fetch('https://bitmatemediator.net/game/v1/enemies').then(res => res.json());

    const categoryTitles = {
        gathered: 'Gathered',
        crafted: 'Crafted',
        rewarded: 'Rewarded',
        kills_mobs: 'Kills (Mobs)',
        kills_bosses: 'Kills (Bosses)'
    };

    // create new rankings for mobs and bosses
    const newRankings = {
        ...rankings,
        kills_mobs: {},
        kills_bosses: {}
    };

    // Separate kills into mobs and bosses
    if (rankings.kills) {
        Object.entries(rankings.kills).forEach(([enemyId, playerRankings]) => {
            if (BOSS_IDS.includes(enemyId)) {
                newRankings.kills_bosses[enemyId] = playerRankings;
            } else {
                newRankings.kills_mobs[enemyId] = playerRankings;
            }
        });
        delete newRankings.kills; // Remove the original kills category
    }

    for (const [category, itemRankings] of Object.entries(newRankings)) {
        if (Object.keys(itemRankings).length === 0) continue; // Skip empty categories

        const categoryElement = document.createElement('div');
        categoryElement.className = 'ranking-category';
        categoryElement.innerHTML = `
            <div class="category-header">
                <h2>${categoryTitles[category]}</h2>
                <span class="toggle-btn">▼</span>
            </div>
            <div class="category-content"></div>
        `;

        const contentElement = categoryElement.querySelector('.category-content');

        for (const [itemId, playerRankings] of Object.entries(itemRankings)) {
            const itemElement = document.createElement('div');
            itemElement.className = 'item-ranking';
            
            let itemName, itemImage;
            if (category === 'kills_mobs' || category === 'kills_bosses') {
                itemName = enemies[itemId] || `Enemy ${itemId}`;
                itemImage = `https://storage.googleapis.com/apes-f984d.appspot.com/Enemies/${itemName}.png`;
            } else {
                const item = items[itemId];
                itemName = item ? item.name : `Item ${itemId}`;
                itemImage = `https://storage.googleapis.com/apes-f984d.appspot.com/s-images/s-${itemId}.png`;
            }

            let displayRankings = playerRankings;
            if (searchTerm && !isNonMember) {
                displayRankings = playerRankings.filter(player => 
                    player.name === searchTerm
                );
            }

            itemElement.innerHTML = `
                <h3>
                    <img src="${itemImage}" alt="${itemName}" class="item-icon" onerror="this.style.display='none'">
                    ${itemName}
                </h3>
                <div class="table-container">
                    <table class="ranking-table">
                        <tr><th>Rank</th><th>Player</th><th>Count</th></tr>
                        ${displayRankings.map((player) => {
                            const realRank = playerRankings.findIndex(p => p.name === player.name) + 1;
                            return `
                                <tr>
                                    <td>${isNonMember ? '-' : realRank}</td>
                                    <td>${player.name}</td>
                                    <td>${player.count}</td>
                                </tr>
                            `;
                        }).join('')}
                    </table>
                </div>
            `;

            contentElement.appendChild(itemElement);
        }

        container.appendChild(categoryElement);
    }

    initializeAllCategoryToggles();
}

function calculatePlayerTotals(rankings) {
    const totalsByCategory = {
        gathered: {},
        crafted: {},
        rewarded: {},
        kills_mobs: {},
        kills_bosses: {}
    };

    Object.entries(rankings).forEach(([category, itemRankings]) => {
        if (category !== 'kills') {
            Object.values(itemRankings).forEach(playerRankings => {
                playerRankings.forEach(player => {
                    if (!totalsByCategory[category][player.name]) {
                        totalsByCategory[category][player.name] = 0;
                    }
                    totalsByCategory[category][player.name] += player.count;
                });
            });
        } else {
            Object.entries(itemRankings).forEach(([enemyId, playerRankings]) => {
                playerRankings.forEach(player => {
                    if (!totalsByCategory.kills_mobs[player.name]) totalsByCategory.kills_mobs[player.name] = 0;
                    if (!totalsByCategory.kills_bosses[player.name]) totalsByCategory.kills_bosses[player.name] = 0;

                    if (BOSS_IDS.includes(enemyId)) {
                        totalsByCategory.kills_bosses[player.name] += player.count;
                    } else {
                        totalsByCategory.kills_mobs[player.name] += player.count;
                    }
                });
            });
        }
    });

    return totalsByCategory;
}

const LEADERBOARD_POINTS = {
    "Total Gathered": {
        "1-3": 5,
        "4-10": 3,
        "11-20": 1
    },
    "Total Crafted": {
        "1-3": 7,
        "4-10": 5,
        "11-20": 3
    },
    "Total Kills (Mobs)": {
        "1-3": 7,
        "4-10": 5,
        "11-20": 3
    },
    "Total Kills (Bosses)": {
        "1-3": 11,
        "4-10": 7,
        "11-20": 5
    },
    "Total Rewarded": {
        "1-3": 5,
        "4-10": 3,
        "11-20": 1
    }
};

function calculateLeaderboardPoints(totalsByCategory) {
    const playerPoints = {};

    Object.entries(totalsByCategory).forEach(([category, playerTotals]) => {
        const categoryTitle = {
            'gathered': 'Total Gathered',
            'crafted': 'Total Crafted',
            'rewarded': 'Total Rewarded',
            'kills_mobs': 'Total Kills (Mobs)',
            'kills_bosses': 'Total Kills (Bosses)'
        }[category];

        if (!categoryTitle) return;

        const sortedPlayers = Object.entries(playerTotals)
            .filter(([, total]) => !isNaN(total) && total >= 0)
            .sort(([, a], [, b]) => b - a);

        sortedPlayers.forEach(([playerName], index) => {
            const rank = index + 1;
            if (!playerPoints[playerName]) playerPoints[playerName] = 0;

            const pointsConfig = LEADERBOARD_POINTS[categoryTitle];
            if (rank <= 3) {
                playerPoints[playerName] += pointsConfig["1-3"];
            } else if (rank <= 10) {
                playerPoints[playerName] += pointsConfig["4-10"];
            } else if (rank <= 20) {
                playerPoints[playerName] += pointsConfig["11-20"];
            }
        });
    });

    return playerPoints;
}

function updateTotalsUI(totalsByCategory, rankingsData) {
    const { isNonMember, searchTerm } = rankingsData;
    const container = document.getElementById('total-rankings-container');
    container.innerHTML = '';

    const categoryTitles = {
        gathered: 'Total Gathered',
        crafted: 'Total Crafted',
        rewarded: 'Total Rewarded',
        kills_mobs: 'Total Kills (Mobs)',
        kills_bosses: 'Total Kills (Bosses)'
    };

    const categoryOrder = ['gathered', 'crafted', 'rewarded', 'kills_mobs', 'kills_bosses'];

    categoryOrder.forEach(category => {
        const playerTotals = totalsByCategory[category];
        const categoryElement = document.createElement('div');
        categoryElement.className = 'item-ranking';
        
        const sortedPlayers = Object.entries(playerTotals)
            .sort(([, a], [, b]) => b - a);

        let displayPlayers = sortedPlayers;
        if (searchTerm && !isNonMember) {
            displayPlayers = sortedPlayers.filter(([name]) => 
                name === searchTerm
            );
        }

        const mappedPlayers = displayPlayers.map(([name, count]) => {
            const realRank = sortedPlayers.findIndex(([n]) => n === name) + 1;
            return {
                rank: isNonMember ? '-' : realRank,
                name,
                count
            };
        });

        categoryElement.innerHTML = `
            <h3>${categoryTitles[category]}</h3>
            <div class="table-container">
                <table class="ranking-table">
                    <tr><th>Rank</th><th>Player</th><th>Total Count</th></tr>
                    ${mappedPlayers.map(player => `
                        <tr>
                            <td>${player.rank}</td>
                            <td>${player.name}</td>
                            <td>${player.count}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        `;

        container.appendChild(categoryElement);
    });

    const downloadIcon = document.createElement('i');
    downloadIcon.className = 'fa-solid fa-file-csv csv-download';
    downloadIcon.title = 'Download All Rankings';
    downloadIcon.style.cursor = 'pointer';

    downloadIcon.addEventListener('click', () => {
        const timePeriod = document.getElementById('time-period').value;
        const allData = [];
        allData.push(['Category', 'Rank', 'Player', 'Count']);
        
        categoryOrder.forEach(category => {
            const playerTotals = totalsByCategory[category];
            const sortedPlayers = Object.entries(playerTotals)
                .sort(([, a], [, b]) => b - a);
            
            const mappedPlayers = sortedPlayers.map(([name, count], index) => ({
                category: categoryTitles[category],
                rank: index + 1,
                name,
                count
            }));
            
            mappedPlayers.forEach(player => {
                allData.push([
                    player.category,
                    player.rank,
                    player.name,
                    player.count
                ]);
            });
        });
        
        const csvContent = allData.map(row => row.join(',')).join('\n');
        downloadCSV(csvContent, `bitmates_all_rankings_${timePeriod}.csv`);
    });

    container.appendChild(downloadIcon);
}

function updateLeaderboardUI(playerPoints, rankingsData) {
    const { isNonMember, searchTerm } = rankingsData;
    const container = document.getElementById('leaderboard-container');
    container.innerHTML = '';

    // Adding the points system explanation
    const pointsExplanation = document.createElement('div');
    pointsExplanation.className = 'item-ranking';
    pointsExplanation.innerHTML = `
        <h3>Points System</h3>
        <div class="points-table-container">
            <table class="ranking-table points-table">
                <tr>
                    <th>Activity</th>
                    <th>Rank 1-3</th>
                    <th>Rank 4-10</th>
                    <th>Rank 11-20</th>
                </tr>
                <tr>
                    <td>Total Gathered</td>
                    <td>5 points</td>
                    <td>3 points</td>
                    <td>1 point</td>
                </tr>
                <tr>
                    <td>Total Crafted</td>
                    <td>7 points</td>
                    <td>5 points</td>
                    <td>3 points</td>
                </tr>
                <tr>
                    <td>Total Rewarded</td>
                    <td>5 points</td>
                    <td>3 points</td>
                    <td>1 point</td>
                </tr>
                <tr>
                    <td>Total Kills (Mobs)</td>
                    <td>7 points</td>
                    <td>5 points</td>
                    <td>3 points</td>
                </tr>
                <tr>
                    <td>Total Kills (Bosses)</td>
                    <td>11 points</td>
                    <td>7 points</td>
                    <td>5 points</td>
                </tr>
            </table>
        </div>
    `;
    container.appendChild(pointsExplanation);

    // Current ranking
    let sortedPlayers = Object.entries(playerPoints)
        .sort(([, a], [, b]) => b - a)
        .map(([name, points], index) => ({
            rank: index + 1,
            name,
            points
        }));

    if (searchTerm && !isNonMember) {
        sortedPlayers = sortedPlayers.filter(player => 
            player.name === searchTerm
        );
    }

    const leaderboardElement = document.createElement('div');
    leaderboardElement.className = 'item-ranking';
    
    leaderboardElement.innerHTML = `
        <h3>Global Ranking</h3>
        <div class="table-container">
            <table class="ranking-table">
                <tr><th>Rank</th><th>Player</th><th>Points</th></tr>
                ${sortedPlayers.map(player => `
                    <tr>
                        <td>${isNonMember ? '-' : player.rank}</td>
                        <td>${player.name}</td>
                        <td>${player.points}</td>
                    </tr>
                `).join('')}
            </table>
        </div>
    `;

    container.appendChild(leaderboardElement);

    // Add CSV download icon
    const downloadIcon = document.createElement('i');
    downloadIcon.className = 'fa-solid fa-file-csv csv-download';
    downloadIcon.title = 'Download Global Ranking';
    downloadIcon.style.cursor = 'pointer';

    downloadIcon.addEventListener('click', () => {
        const timePeriod = document.getElementById('time-period').value;
        const csvData = [['Rank', 'Player', 'Points']];
        
        sortedPlayers.forEach(player => {
            csvData.push([
                isNonMember ? '-' : player.rank,
                player.name,
                player.points
            ]);
        });
        
        const csvContent = csvData.map(row => row.join(',')).join('\n');
        downloadCSV(csvContent, `bitmates_global_ranking_${timePeriod}.csv`);
    });

    container.appendChild(downloadIcon);
}

async function showRanking() {
    const rankingContainer = document.getElementById('ranking-container');
    const totalSection = document.querySelector('.total-section');
    const leaderboardSection = document.querySelector('.leaderboard-section');
    const timeSelector = document.querySelector('.time-selector');
    const searchContainer = document.querySelector('.search-container');
    
    rankingContainer.innerHTML = "<h2 class='loading-text'>Loading</h2>";
    totalSection.style.display = 'none';
    leaderboardSection.style.display = 'none';
    timeSelector.style.display = 'none';
    searchContainer.style.display = 'none';

    try {
        const timePeriod = document.getElementById('time-period').value;
        const rankingsData = await generateRanking(timePeriod);
        await updateRankingUI(rankingsData);
        
        const totalsByCategory = calculatePlayerTotals(rankingsData.rankings);
        updateTotalsUI(totalsByCategory, rankingsData);
        
        // Calculate and update the Leaderboard
        const playerPoints = calculateLeaderboardPoints(totalsByCategory);
        updateLeaderboardUI(playerPoints, rankingsData);
        
        initializeAllCategoryToggles();
        
        timeSelector.style.display = 'block';
        searchContainer.style.display = 'block';
        totalSection.style.display = 'block';
        leaderboardSection.style.display = 'block';
 
    } catch (error) {
        console.error("Error to load ranking:", error.message);
        searchContainer.style.display = 'block';
        rankingContainer.innerHTML = "<h2 class='error-text'>Player not found. Please try again.</h2>";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    function createHeader() {
        const header = document.createElement('header');
        header.classList.add('page-header');
        
        header.innerHTML = `
            <div class="header-top">
                <a href="https://bitmates.io/" target="_blank" class="image-link">
                    <img src="https://bitmates.io/assets/BitmatesLogo1-DL6rVBW_.png" alt="Logo" class="zoom-effect">
                </a>
            </div>
        `;

        return header;
    }

    document.body.insertBefore(createHeader(), document.body.firstChild);
    
    showRanking();

    // Add listener for the search button
    document.getElementById('search-button').addEventListener('click', () => {
        showRanking();
    });

    // Add listener for the Enter key in the search field
    document.getElementById('player-search').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            showRanking();
        }
    });

    // Add a listener to clear the search field when clicked
    document.getElementById('player-search').addEventListener('click', () => {
        const searchInput = document.getElementById('player-search');
        searchInput.value = ''; // Clear the search field
    });

});

document.getElementById('time-period').addEventListener('change', showRanking);
document.getElementById('refresh-icon').addEventListener('click', showRanking);

const itemNames = {
    // Example: '1000': 'Item Name 1000'
};

const enemyNames = {
    // Example: '1': 'Enemy Name 1'
};

function destroyChart(chartId) {
    const chart = Chart.getChart(chartId);
    if (chart) {
        chart.destroy();
    }
}

let charts = {};

function updateChart(chartId, type, labels, data, title) {
    if (charts[chartId]) {
        charts[chartId].destroy();
    }

    const ctx = document.getElementById(chartId).getContext('2d');
    charts[chartId] = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
                    '#FF9F40', '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0'
                ],
                borderColor: '#3f2832',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: title,
                    font: {
                        family: "'Press Start 2P', cursive",
                        size: 14
                    },
                    color: '#3f2832'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.label}: ${context.formattedValue}`;
                        }
                    }
                }
            }
        }
    });
}

function initializeAllCategoryToggles() {
    const categories = document.querySelectorAll('.ranking-category');
    categories.forEach(category => {
        const header = category.querySelector('.category-header');
        const content = category.querySelector('.category-content');
        const toggleBtn = header.querySelector('.toggle-btn');

        header.removeEventListener('click', toggleCategoryHandler);
        
        header.addEventListener('click', toggleCategoryHandler);
    });
}

function toggleCategoryHandler(event) {
    const header = event.currentTarget;
    const content = header.nextElementSibling;
    const toggleBtn = header.querySelector('.toggle-btn');

    content.classList.toggle('active');
    toggleBtn.textContent = content.classList.contains('active') ? '▲' : '▼';
    event.stopPropagation();
}

const BOSS_IDS = ['5', '16', '17', '18', '19', '50'];

function convertToCSV(players) {
    const csvRows = [];
    csvRows.push(['Rank', 'Player', 'Count']);
    
    players.forEach(player => {
        csvRows.push([player.rank, player.name, player.count]);
    });
    
    return csvRows.map(row => row.join(',')).join('\n');
}

function downloadCSV(csvContent, fileName) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function updateTotalRankings(rankings) {
    const container = document.getElementById('total-rankings-container');
    
    Object.entries(rankings).forEach(([category, data]) => {
        // Order players by current count
        const sortedPlayers = [...data].sort((a, b) => {
            // First criterion: current count
            if (b[1] !== a[1]) return b[1] - a[1];
            
            // Second criterion: total sum
            const totalA = rankings[category].reduce((sum, player) => 
                player[0] === a[0] ? sum + player[1] : sum, 0);
            const totalB = rankings[category].reduce((sum, player) => 
                player[0] === b[0] ? sum + player[1] : sum, 0);
            if (totalB !== totalA) return totalB - totalA;
            
            // Third criterion: Total Rewarded
            const rewardedRankings = rankings['rewarded_'] || [];
            const rewardedA = rewardedRankings.find(p => p[0] === a[0])?.[1] || 0;
            const rewardedB = rewardedRankings.find(p => p[0] === b[0])?.[1] || 0;
            return rewardedB - rewardedA;
        });

    });
}

function updateLeaderboard(playerPoints) {
    // Order players by points
    const sortedPlayers = Object.entries(playerPoints)
        .sort(([nameA, pointsA], [nameB, pointsB]) => {
            // First criterion: points
            if (pointsB !== pointsA) return pointsB - pointsA;
            
            // Second criterion: total sum
            const totalA = Object.values(rankings).reduce((sum, category) => {
                const player = category.find(p => p[0] === nameA);
                return sum + (player?.[1] || 0);
            }, 0);
            
            const totalB = Object.values(rankings).reduce((sum, category) => {
                const player = category.find(p => p[0] === nameB);
                return sum + (player?.[1] || 0);
            }, 0);
            
            if (totalB !== totalA) return totalB - totalA;
            
            // Third criterion: Total Rewarded
            const rewardedRankings = rankings['rewarded_'] || [];
            const rewardedA = rewardedRankings.find(p => p[0] === nameA)?.[1] || 0;
            const rewardedB = rewardedRankings.find(p => p[0] === nameB)?.[1] || 0;
            return rewardedB - rewardedA;
        });
}

