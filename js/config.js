// Piano Tutor settings for ads and the one-time "Remove ads" purchase.
// Fill these in after creating your Google AdSense and Lemon Squeezy accounts (see README).

export const CONFIG = {
  appName: 'Piano Tutor',

  ads: {
    // Google AdSense publisher id, e.g. 'ca-pub-1234567890123456'.
    // Leave empty to show the "Remove ads" banner in the ad spots instead (the desktop app always does).
    adsenseClient: '',
    // AdSense ad unit ids for each spot on the page
    slots: {
      library: '', // wide banner above the song list
      sidebar: '', // square under the sidebar menu
    },
  },

  upgrade: {
    price: '$10',
    // Lemon Squeezy checkout link for the "Remove ads" product, e.g. 'https://pianotutor.lemonsqueezy.com/buy/abc123'
    checkoutUrl: '',
    // Only licence keys from this store and product unlock the app (numbers from the Lemon Squeezy dashboard).
    // Leave 0 to accept any valid Lemon Squeezy key while testing.
    storeId: 0,
    productId: 0,
  },
};
