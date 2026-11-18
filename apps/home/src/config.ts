// Contact form settings for the home page.
//
// The Web3Forms access key is public by design: it can only deliver messages to the inbox
// it was created for (the same key the portfolio site's form uses), and it doesn't reveal
// that inbox's address. (Web3Forms: https://web3forms.com)
export const WEB3FORMS_ACCESS_KEY = "a6b0ed73-392d-4c37-8e34-6415d0125fb6";
export const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

// Limits shown to the visitor and enforced before sending.
export const LIMITS = { name: 100, email: 254, message: 3000 } as const;
export const MIN_SECONDS_BETWEEN_SENDS = 60;
