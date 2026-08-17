/**
 * Clamp a 200px donut menu so it stays inside the map container
 * and below mobile chrome.
 */

const MENU_SIZE = 200;

/**
 * @param {{ x: number, y: number }} point - Map pixel coordinates
 * @param {number} [size=200] - Menu width/height in pixels
 * @returns {{ left: number, top: number }} CSS left/top for the menu element
 */
export function clampDonutMenuPosition(point, size = MENU_SIZE) {
  const container = document.getElementById('map_container');
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  const half = size / 2;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const topInset = isMobile ? 110 : 8;
  const bottomInset = isMobile ? 88 : 8;
  const sideInset = 8;

  const x = Math.min(Math.max(point.x, half + sideInset), width - half - sideInset);
  const y = Math.min(Math.max(point.y, half + topInset), height - half - bottomInset);

  return { left: x - half, top: y - half };
}
