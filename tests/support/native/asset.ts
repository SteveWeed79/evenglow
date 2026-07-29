/**
 * Any bundled image, under test.
 *
 * Metro turns `require('../../assets/plaster.png')` into an asset descriptor
 * with a density set. Node has no such loader, so every `.png` resolves here
 * instead — the plaster tile is a texture, and nothing about it is worth
 * asserting from a test that cannot see pixels.
 */
export default { uri: 'test://asset.png', width: 64, height: 64, scale: 1 };
