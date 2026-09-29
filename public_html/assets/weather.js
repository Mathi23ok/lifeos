// Qeshm weather and marine data are served together by the local PHP endpoint.
const $ = id => document.getElementById(id);
const finite = value => typeof value === 'number' && Number.isFinite(value);
let lastAttempt = 0;
let inFlight = null;

function description(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return ['Clear sky', 'Mostly clear', 'Partly cloudy', 'Overcast'][code];
  if ([45, 48].includes(code)) return 'Foggy';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain showers';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorms';
  return 'Weather forecast';
}

function symbol(code, isDay = true) {
  const sun = '<circle cx="25" cy="25" r="9"/><path d="M25 3v7M25 40v7M3 25h7M40 25h7M9.5 9.5l5 5M35.5 35.5l5 5M40.5 9.5l-5 5M14.5 35.5l-5 5"/>';
  const moon = '<path d="M33 7a18 18 0 1 0 16 28A19 19 0 0 1 33 7Z"/>';
  const cloud = '<path d="M17 38h27a10 10 0 0 0 0-20 15 15 0 0 0-28.5-2.5A11 11 0 0 0 17 38Z"/>';
  let shapes;
  if (code === 0) shapes = isDay ? sun : moon;
  else if (code <= 2) shapes = `<g class="weather-sun">${isDay ? sun : moon}</g><g class="weather-cloud">${cloud}</g>`;
  else if (code <= 3 || [45, 48].includes(code)) shapes = cloud;
  else if ([95, 96, 99].includes(code)) shapes = `${cloud}<path d="m31 39-5 8h6l-4 9"/>`;
  else if ([71, 73, 75, 77, 85, 86].includes(code)) shapes = `${cloud}<path d="m20 46 1 2m12-2 1 2m11-2 1 2"/>`;
  else shapes = `${cloud}<path d="m20 45-2 5m15-5-2 5m15-5-2 5"/>`;
  return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
}

function windDirection(degrees) {
  if (!finite(degrees)) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

function renderWeather(data) {
  const current = data?.current;
  const daily = data?.daily;
  if (!current || !finite(current.temperature_2m) || !Array.isArray(daily?.time) || daily.time.length < 4) throw new Error('Incomplete weather data');
  $('kish-weather-temperature').innerHTML = `${Math.round(current.temperature_2m)}<small>°C</small>`;
  $('kish-weather-condition').textContent = description(current.weather_code);
  $('kish-weather-icon').innerHTML = symbol(current.weather_code, Boolean(current.is_day));
  $('kish-weather-feels').textContent = finite(current.apparent_temperature) ? `${Math.round(current.apparent_temperature)}°C` : '—';
  $('kish-weather-wind').textContent = finite(current.wind_speed_10m) ? `${Math.round(current.wind_speed_10m)} km/h ${windDirection(current.wind_direction_10m)}`.trim() : '—';
  $('kish-weather-humidity').textContent = finite(current.relative_humidity_2m) ? `${Math.round(current.relative_humidity_2m)}%` : '—';
  $('kish-weather-updated').textContent = `Updated ${current.time?.slice(11, 16) || '—'} · Qeshm local time`;
  const dayNames = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
  const days = daily.time.slice(1, 4).map((date, index) => {
    const i = index + 1;
    const name = dayNames.format(new Date(`${date}T12:00:00Z`));
    const high = finite(daily.temperature_2m_max?.[i]) ? `${Math.round(daily.temperature_2m_max[i])}°` : '—';
    const low = finite(daily.temperature_2m_min?.[i]) ? `${Math.round(daily.temperature_2m_min[i])}°` : '—';
    return `<div class="kish-forecast-day" aria-label="${name}: ${description(daily.weather_code?.[i])}, high ${high}, low ${low}"><span>${name}</span>${symbol(daily.weather_code?.[i])}<strong>${high} <small>${low}</small></strong></div>`;
  });
  $('kish-weather-forecast').querySelector('.kish-forecast-days').innerHTML = days.join('');
  $('kish-weather-status').innerHTML = '<i></i> Live forecast';
}

function renderMarine(data) {
  const current = data?.current;
  const times = data?.hourly?.time;
  const heights = data?.hourly?.sea_level_height_msl;
  if (!finite(current?.sea_level_height_msl) || !Array.isArray(times) || !Array.isArray(heights)) throw new Error('Incomplete marine data');
  const now = current.time;
  const nextIndex = times.findIndex(time => time > now);
  const future = nextIndex >= 0 ? heights[nextIndex] : null;
  const delta = finite(future) ? future - current.sea_level_height_msl : 0;
  const phase = delta > 0.015 ? 'Rising tide' : delta < -0.015 ? 'Falling tide' : 'Near a turn';
  let nextTurn = null;
  for (let i = Math.max(nextIndex, 1); i < heights.length - 1; i++) {
    if (!finite(heights[i - 1]) || !finite(heights[i]) || !finite(heights[i + 1])) continue;
    if (heights[i] >= heights[i - 1] && heights[i] > heights[i + 1]) { nextTurn = { type: 'high', time: times[i] }; break; }
    if (heights[i] <= heights[i - 1] && heights[i] < heights[i + 1]) { nextTurn = { type: 'low', time: times[i] }; break; }
  }
  $('kish-tide-state').textContent = phase;
  const level = `${current.sea_level_height_msl >= 0 ? '+' : ''}${current.sea_level_height_msl.toFixed(2)} m vs mean sea level`;
  const turn = nextTurn ? `Next ${nextTurn.type} ${nextTurn.time.slice(0, 10) === now.slice(0, 10) ? '' : 'tomorrow '}${nextTurn.time.slice(11, 16)} · ` : '';
  $('kish-tide-detail').textContent = `${turn}${level}`;
}

async function getJson() {
  const response = await fetch('weather.php', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(16000) });
  if (!response.ok) throw new Error(`Forecast service ${response.status}`);
  return response.json();
}

export function refreshWeatherCard() {
  const card = $('kish-weather');
  if (!card || inFlight || Date.now() - lastAttempt < 15 * 60 * 1000) return inFlight;
  lastAttempt = Date.now();
  card.setAttribute('aria-busy', 'true');
  inFlight = getJson().then(data => {
    try { renderWeather(data.weather); }
    catch { showWeatherUnavailable(); }
    try { renderMarine(data.marine); }
    catch { showMarineUnavailable(); }
  }).catch(() => {
    showWeatherUnavailable();
    showMarineUnavailable();
  }).finally(() => { card.setAttribute('aria-busy', 'false'); inFlight = null; });
  return inFlight;
}

function showWeatherUnavailable() {
  $('kish-weather-status').textContent = 'Weather unavailable';
  $('kish-weather-temperature').innerHTML = '—<small>°C</small>';
  $('kish-weather-condition').textContent = 'Forecast temporarily unavailable';
  $('kish-weather-icon').innerHTML = '';
  $('kish-weather-feels').textContent = '—';
  $('kish-weather-wind').textContent = '—';
  $('kish-weather-humidity').textContent = '—';
  $('kish-weather-forecast').querySelector('.kish-forecast-days').textContent = '3-day forecast unavailable';
  $('kish-weather-updated').textContent = 'Qeshm local time · Asia/Tehran';
}

function showMarineUnavailable() {
  $('kish-tide-state').textContent = 'Tide estimate unavailable';
  $('kish-tide-detail').textContent = 'Try again shortly';
}
