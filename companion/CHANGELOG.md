# woofx3 desktop changelog

## [0.26.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.25.0...woofx3-v0.26.0) (2026-11-23)

### Features

* **commands:** name the command and its inputs separately instead of typing {name} captures ([bf99afb](https://github.com/wolfymaster/woofx3-ui/commit/bf99afb8ea9a4723792c1aa1267edbc6e8ba7d36))
* **scenes:** Draft/Live selector with Discard and Publish in plain sight while drafting ([9c30c56](https://github.com/wolfymaster/woofx3-ui/commit/9c30c56222cb4fd8cb22c94cf2953d9e05e1a10c))
* **ui:** add shared SaveBar, TwitchConnectNotice and common copy constants ([1411b01](https://github.com/wolfymaster/woofx3-ui/commit/1411b013c8ee5658a1d86b46fe6fa97297894562))

### Bug Fixes

* **copy:** drop raw field ids from test-event form, say account on the team page ([8f054f9](https://github.com/wolfymaster/woofx3-ui/commit/8f054f99055c47bb5ffb23c0c4a5c4d47bdb0c8a))
* **copy:** drop remaining engine wording from recap, test-event, import and backup text ([037cc32](https://github.com/wolfymaster/woofx3-ui/commit/037cc320dbc18d00eca18cf4405ec850901b2b79))
* **copy:** drop remaining please, owner-or-admin and failed-to wording ([c797640](https://github.com/wolfymaster/woofx3-ui/commit/c797640bb7b0f7e3143987956cedd1f8f65e865b))
* **copy:** module page shows the readme, not the manifest description or id ([682ab21](https://github.com/wolfymaster/woofx3-ui/commit/682ab21fdf5d06b39d5c8e45158e107623129916))
* **copy:** new workflow page says Save and drops the repeated trigger sentence ([853d113](https://github.com/wolfymaster/woofx3-ui/commit/853d113cf997a70a32a3164188c27c18266f1344))
* **copy:** plain-language account, billing, feedback and admin text ([29ab3ca](https://github.com/wolfymaster/woofx3-ui/commit/29ab3ca0fccc314adb011cbe6b16758d3c0ee6c3))
* **copy:** plain-language alerts, scenes and test-event text ([06bf3ab](https://github.com/wolfymaster/woofx3-ui/commit/06bf3ab7f71e9f8bcb9322a0fcf7751e9acff1f5))
* **copy:** plain-language dashboard, layout, recap and moderation text ([e3c3d58](https://github.com/wolfymaster/woofx3-ui/commit/e3c3d58e0bf5aa0e0c173544017b7367b71b5486))
* **copy:** plain-language module, marketplace and user-page text ([9399b26](https://github.com/wolfymaster/woofx3-ui/commit/9399b26d72c4040d2a21e79c8479788e273f7315))
* **copy:** plain-language setup, onboarding, settings and desktop text ([9b592aa](https://github.com/wolfymaster/woofx3-ui/commit/9b592aae3f640d7ebcfda72a6e7175258bc65842))
* **copy:** plain-language workflow, command and resource text, with Save bars ([1546c47](https://github.com/wolfymaster/woofx3-ui/commit/1546c4778c4d3fc1db111ba46e7e4f799ac0c797))
* **copy:** say account instead of organization and module instead of add-on ([95a98eb](https://github.com/wolfymaster/woofx3-ui/commit/95a98ebaa1bcc3e1a62c60b9434fd265b74de013))
* **copy:** say owners and admins where both roles may act, owner only where only the owner may ([7c4f8f1](https://github.com/wolfymaster/woofx3-ui/commit/7c4f8f1115ccf62c5ed212e025cf6397ac71e123))
* **copy:** shared wording in lib helpers ([78e1f4e](https://github.com/wolfymaster/woofx3-ui/commit/78e1f4ebfd55dbdcdc83605e30342c081bc8de34))
* **copy:** warn when a command word has spaces, log swallowed errors, trim page intros that repeat ([983eec3](https://github.com/wolfymaster/woofx3-ui/commit/983eec3f6f217cd10e4b44403275be16fd7e4476))
* **scenes:** show which of Draft and Live is selected ([5ca15f7](https://github.com/wolfymaster/woofx3-ui/commit/5ca15f73982847c80d7b2a3972fc119ff79cf0a3))

## [0.25.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.24.0...woofx3-v0.25.0) (2026-11-23)

### Features

* **ui:** fold module details into Module Settings ([d506f01](https://github.com/wolfymaster/woofx3-ui/commit/d506f019863977375b69c61d6f692ad03363e9b4))
* **ui:** make the module details page the Module Settings page ([e187c36](https://github.com/wolfymaster/woofx3-ui/commit/e187c366d5dba04466fd7df00b5e815733f598b4))
* **ui:** open a module's full page inside Module Settings ([100d3de](https://github.com/wolfymaster/woofx3-ui/commit/100d3de2c32a2ac5766c8bc2dc5acb85a2a857c0))
* **ui:** split modules into Installed Modules and Module Settings ([65c9201](https://github.com/wolfymaster/woofx3-ui/commit/65c9201111338a7cbb7c50297c5c386a7eafc3c3))
* **ui:** use the module page's tab style on Module Settings ([e31a0a4](https://github.com/wolfymaster/woofx3-ui/commit/e31a0a48b98ebaaadc23a1d69dc9fe828dbf67b0))

### Bug Fixes

* **commands:** insert a chosen value at the cursor; call the command text 'Message text' ([209b64d](https://github.com/wolfymaster/woofx3-ui/commit/209b64d7663af301a6c4e370f747810db933caf0))
* **ui:** open every installed module on its Settings tab ([2c40a1d](https://github.com/wolfymaster/woofx3-ui/commit/2c40a1d7e0cc8b13d57163b7a2cd2d37d26821d8))

## [0.24.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.23.0...woofx3-v0.24.0) (2026-11-22)

### Features

* **commands:** add helpers for a command's schedule ([b3f64db](https://github.com/wolfymaster/woofx3-ui/commit/b3f64db4644592abf301aa83aafa82e25ed40508))
* **commands:** run a command on a schedule from its editor ([7f320f5](https://github.com/wolfymaster/woofx3-ui/commit/7f320f5a18fb9e6f5cba02db02e3106d551cd1b3))

## [0.23.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.22.0...woofx3-v0.23.0) (2026-11-22)

### Features

* **commands:** make the command field a multi-line text box ([ac0eedc](https://github.com/wolfymaster/woofx3-ui/commit/ac0eedcd2b6333150d70e3cc50e2484dedec8fe9))

### Bug Fixes

* **ops:** let a nullable enum in the spec admit null ([5fb1208](https://github.com/wolfymaster/woofx3-ui/commit/5fb120843af1d958721ab495759610d00dbc502d))

## [0.22.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.21.0...woofx3-v0.22.0) (2026-11-19)

### Features

* **desktop:** bundle engine v0.72.0 ([96fcb54](https://github.com/wolfymaster/woofx3-ui/commit/96fcb545cc0415e73798cd1bd1eecb23bc00f287))

### Bug Fixes

* **marketplace:** stop downloading archives before a listing is claimed ([9720a28](https://github.com/wolfymaster/woofx3-ui/commit/9720a287567efcd9304f22af03ea730f00477fd2))

## [0.21.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.20.0...woofx3-v0.21.0) (2026-11-19)

### Features

* **account:** change plan in place with a charge breakdown ([855d24c](https://github.com/wolfymaster/woofx3-ui/commit/855d24cf80649845d139f08f5f1fa938ea1817ea))
* **account:** engine access follows the selected organization ([6b0fc6b](https://github.com/wolfymaster/woofx3-ui/commit/6b0fc6b4ec51cc4df718fad6725fa136a18d0c8b))
* **account:** Engines page, engine dashboard and a docked Upgrade entry ([2208533](https://github.com/wolfymaster/woofx3-ui/commit/2208533943ae3a7e573a73a63f7fea26958d0f8c))
* **account:** fold People into the portal's Team page ([47ba2cb](https://github.com/wolfymaster/woofx3-ui/commit/47ba2cb13671cbcdd3c5b6deef63ec218cc14bb6))
* **account:** make the portal Overview a dashboard of engines and plan ([59ab396](https://github.com/wolfymaster/woofx3-ui/commit/59ab3961a78a32c459a20d7012c2ba555c64b8b0))
* **account:** organization Settings with General and Plans ([5bbf09e](https://github.com/wolfymaster/woofx3-ui/commit/5bbf09e8d75735fb12b4b2030f1db0e76a03b8e9))
* **account:** scale the engine dashboard's module list ([af068dd](https://github.com/wolfymaster/woofx3-ui/commit/af068dde2e8250ccaafc61cbdb9e4b9c8e0bf509))
* **account:** scope-aware nav, one Team page and an organization dashboard ([6866667](https://github.com/wolfymaster/woofx3-ui/commit/686666799586b81d82b37d52fb689bf6849f80c4))
* **account:** show connection health, last report and channel on engine cards ([e4b1d0e](https://github.com/wolfymaster/woofx3-ui/commit/e4b1d0e79b406afbc1aa6ddbb3a6edde1672cc0b))
* **account:** switch between Personal and organizations in the portal header ([3fc83f5](https://github.com/wolfymaster/woofx3-ui/commit/3fc83f5fe03c62355cbafc1474ad48f9c6c987de))
* **auth:** hide the sign-up visitor check unless it needs the visitor ([886ccd4](https://github.com/wolfymaster/woofx3-ui/commit/886ccd4e6ca26aa422d3e117d58fea5c98bae3dd))
* **onboarding:** choose a plan first on the web ([c2bd758](https://github.com/wolfymaster/woofx3-ui/commit/c2bd7587c6558902745bc30242b0623db27f5991))
* **onboarding:** show the web plan step on the sign-in background ([f858a1d](https://github.com/wolfymaster/woofx3-ui/commit/f858a1d41deb84e4d9625bbb31275980d7bd22e3))
* **sponsorship:** return sponsors to their own page after the provider ([7d5c790](https://github.com/wolfymaster/woofx3-ui/commit/7d5c790227f295cdfcaac675a54e73942497439e))
* **team:** add an organization member to an engine and list invitations org-wide ([cc6e894](https://github.com/wolfymaster/woofx3-ui/commit/cc6e89417526cddb9947397400f5eb4b9ac4a00c))

### Bug Fixes

* **account:** list every plan on Plans, also for self-hosted organizations ([006caf5](https://github.com/wolfymaster/woofx3-ui/commit/006caf5ca274a70ca64d6095073fe21ad310eb51))

## [0.20.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.19.0...woofx3-v0.20.0) (2026-11-19)

### Features

* **alerts:** sentence-first trigger editor with inline install recipes ([f180de8](https://github.com/wolfymaster/woofx3-ui/commit/f180de8db6b08e6222cfe4ad841f7b9da88034db))

## [0.19.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.18.0...woofx3-v0.19.0) (2026-11-19)

### Features

* **auth:** carry a referral link code through sign-up ([76e6004](https://github.com/wolfymaster/woofx3-ui/commit/76e6004bf671ba2987dbb05ecc8d5b0dca04eca8))
* **client:** ask for the emailed code on the invite page and in settings ([99449a5](https://github.com/wolfymaster/woofx3-ui/commit/99449a550aa72d1b306131de5daf55babba73feb))

## [0.18.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.17.0...woofx3-v0.18.0) (2026-11-18)

### Features

* **feature-flags:** manage flag definitions through the ops API ([858b2a4](https://github.com/wolfymaster/woofx3-ui/commit/858b2a452f6147494f237cf3c677d80d6b0f405d))

## [0.17.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.16.0...woofx3-v0.17.0) (2026-11-18)

### Features

* **scenes:** group the widget palette by purpose ([b0ef2ed](https://github.com/wolfymaster/woofx3-ui/commit/b0ef2eddfe5139e07c2001e5708033cde0a244ca))

## [0.16.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.15.0...woofx3-v0.16.0) (2026-11-17)

### Features

* **modules:** add a Modules group to the Stream sidebar ([532818d](https://github.com/wolfymaster/woofx3-ui/commit/532818d0e75f06a4bfa394458f12a60d0dae1327))
* **nav:** give Alert Groups its own Stream sidebar entry ([09e07b8](https://github.com/wolfymaster/woofx3-ui/commit/09e07b84fd3a1d53131f366d53bab64c3e71e886))
* **nav:** group the Stream sidebar by job ([5794587](https://github.com/wolfymaster/woofx3-ui/commit/5794587efcef3521b5e39903ebfebcf3ccddf98a))

### Bug Fixes

* **billing:** answer a suspended org's invite accept with a status ([72090c4](https://github.com/wolfymaster/woofx3-ui/commit/72090c45f8f6632efb45b51362c9a095976c3a06))
* **invitations:** take a new seat only on an inviter's spendSeat ([5e46a7d](https://github.com/wolfymaster/woofx3-ui/commit/5e46a7daa6ee5d07707ba17b24feefea0d562b94))
* **nav:** give Alert Groups an icon of its own ([88cd94c](https://github.com/wolfymaster/woofx3-ui/commit/88cd94c3938c1101952e7972a87ac0487933eae8))
* **nav:** show installed modules and Alert Groups in the Stream sidebar ([6bda7fe](https://github.com/wolfymaster/woofx3-ui/commit/6bda7fef68d59884ceb5c3faf3a4872debc07704))

## [0.15.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.14.0...woofx3-v0.15.0) (2026-11-17)

### Features

* **desktop:** show updates in a thin full-width bar above the header ([cb69682](https://github.com/wolfymaster/woofx3-ui/commit/cb696820bb74b6d8c8324a1c80a1e612e56b6e70))

### Bug Fixes

* **desktop:** use output for the update bar's live region ([3d5d333](https://github.com/wolfymaster/woofx3-ui/commit/3d5d3334891494cb11e8e3a6a7dca6e65865da0b))

## [0.14.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.13.0...woofx3-v0.14.0) (2026-11-17)

### Features

* **account:** move settings, team and admin into the account portal ([336ecf3](https://github.com/wolfymaster/woofx3-ui/commit/336ecf3c8671132ed355be43f82f0b872226f4d3))

## [0.13.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.12.0...woofx3-v0.13.0) (2026-11-17)

### Features

* **marketplace:** pin the marketplace spec and its type generator ([7c40482](https://github.com/wolfymaster/woofx3-ui/commit/7c4048216124224defffea5cb1e74175fb6e565e))
* **portal:** show plan prices and names from the plane ([babd039](https://github.com/wolfymaster/woofx3-ui/commit/babd039ea3ae6a484ed696af5d4d4a196dfd263e))

### Bug Fixes

* **billing:** refuse plane URLs that are not absolute https ([dc4a474](https://github.com/wolfymaster/woofx3-ui/commit/dc4a474c16be39e7fc50a9036a1ea5cece71b055))
* **engines:** only the org owner may delete an engine ([64299a7](https://github.com/wolfymaster/woofx3-ui/commit/64299a7f16374b89a8ee1da0937abeb38532d70e))
* **engines:** restrict engine url changes to the org owner ([0438874](https://github.com/wolfymaster/woofx3-ui/commit/0438874a2a051f2aa52180b5116ae43a664ba30d))

## [0.12.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.11.0...woofx3-v0.12.0) (2026-11-17)

### Features

* **account:** use the dashboard frame and tier cards for choosing a plan ([d849a84](https://github.com/wolfymaster/woofx3-ui/commit/d849a843912b52fa869371703ac5cc3b457cb637))
* **auth:** dress the signed-out screens like the marketing site ([e97bc79](https://github.com/wolfymaster/woofx3-ui/commit/e97bc791bb208efc805e95f3ef577418a523c2ac))
* **auth:** publish a signed-in hint for the marketing site ([04db768](https://github.com/wolfymaster/woofx3-ui/commit/04db768325f778cc0bae0aa47bfdd73a5b9250de))

## [0.11.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.10.0...woofx3-v0.11.0) (2026-11-16)

### Features

* **account-portal:** create another engine from the Engines page ([69f6a68](https://github.com/wolfymaster/woofx3-ui/commit/69f6a68f6d0db73c9de38daa848b85d1754ee036))
* **account-portal:** key the portal to the person at /account ([cfcba95](https://github.com/wolfymaster/woofx3-ui/commit/cfcba952e4fb7732465b3e4bca31bba99b10f589))
* **account-portal:** offer an engine to a user with no organization ([a2250aa](https://github.com/wolfymaster/woofx3-ui/commit/a2250aabe02e91efcf01d17ba4ec6e764687d5ad))
* **account-portal:** one Account entry in the profile menu ([bd39acb](https://github.com/wolfymaster/woofx3-ui/commit/bd39acb658153842289edde0006d9169ba0fa8d8))
* **auth:** check password sign-up with Cloudflare Turnstile ([c3da27a](https://github.com/wolfymaster/woofx3-ui/commit/c3da27aee68d75d56a6ee0ad09771df840656803))
* **onboarding:** make an organization only when an engine is chosen ([b69d0d7](https://github.com/wolfymaster/woofx3-ui/commit/b69d0d7c396ce36030cc3a76379a65847799e0ab))
* **onboarding:** send a user with no organization to their account ([e2612a0](https://github.com/wolfymaster/woofx3-ui/commit/e2612a047288b054c85c11b8eae9927c2cdfbdfc))
* **sponsorships:** /sponsor/start confirm screen ([fcc2924](https://github.com/wolfymaster/woofx3-ui/commit/fcc29240d219060de37a535927dd65b02339be07))
* **sponsorships:** confirm a return from the card-update page ([db6a31b](https://github.com/wolfymaster/woofx3-ui/commit/db6a31bbb3c17c4f80370c0e6f2667eeabe1abad))
* **sponsorships:** sponsorship section and sponsor rows in the portal ([0d46c2b](https://github.com/wolfymaster/woofx3-ui/commit/0d46c2bee255aeb22a1c3913c8618706a160f2f2))

### Bug Fixes

* **account-portal:** an org with no billing yet has no invoices, not an error ([c624abe](https://github.com/wolfymaster/woofx3-ui/commit/c624abe6d1c198979540e40dc4c8da2881a01af2))
* **account-portal:** no back-to-dashboard link for a viewer with no engine ([0f654ae](https://github.com/wolfymaster/woofx3-ui/commit/0f654aed0e4dba393f4d58c81e1e2fe483366ba1))
* **account-portal:** show one error, not an empty state, when billing fails ([0a44c28](https://github.com/wolfymaster/woofx3-ui/commit/0a44c283e680f0ab2100af4548bc558c63949347))
* **account-portal:** show payment rows as each lookup answers ([ac67f33](https://github.com/wolfymaster/woofx3-ui/commit/ac67f33f4631ac5e8b41129e3b1cabc6c0543709))
* **account-portal:** stack People and Engines rows at phone widths ([9d79e2c](https://github.com/wolfymaster/woofx3-ui/commit/9d79e2cce04c15f67d187d4be9d8885ab9054275))
* **account-portal:** tell same-named organizations apart in the switcher ([eb3b515](https://github.com/wolfymaster/woofx3-ui/commit/eb3b515a05ed559c378b312cc63e775e5180feb6))
* **auth:** bound the wait after sign-in and stop on a session-less result ([11c2972](https://github.com/wolfymaster/woofx3-ui/commit/11c2972abf83e55a99ffb67397cac8c59c54def3))
* **billing:** reflow the payments list at phone widths and drop an empty link column ([501698c](https://github.com/wolfymaster/woofx3-ui/commit/501698c8f941501854b336dafcbe98539c75a27e))
* **instances:** only the owner renames an engine ([87973db](https://github.com/wolfymaster/woofx3-ui/commit/87973dbe5d4059949eaef9f4076e2ec62454d530))
* **organizations:** only the owner renames the organization ([f2bdfac](https://github.com/wolfymaster/woofx3-ui/commit/f2bdfac8dac293990438f95bcfa77aa2b07034a3))
* **setup:** send a user with no engine to their account like the dashboard does ([0dac834](https://github.com/wolfymaster/woofx3-ui/commit/0dac83431c2a71beef09312657dfd29b93bb2de8))
* **sponsorships:** a sponsor's cancel always ends at period end ([a36fc5c](https://github.com/wolfymaster/woofx3-ui/commit/a36fc5cbf5c2006f192b00f8e1be7fe533f471dc))
* **sponsorships:** a sponsorship set to end reads Ending, not Active ([69a7fbf](https://github.com/wolfymaster/woofx3-ui/commit/69a7fbfda52933ba110f70d4d3ebfbb7d245b957))
* **sponsorships:** the cancel dialog's dismiss button says Keep sponsorship ([a70a01d](https://github.com/wolfymaster/woofx3-ui/commit/a70a01d791c942e59b791df450a594b0714a55f8))

## [0.10.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.9.0...woofx3-v0.10.0) (2026-11-14)

### Features

* **org-portal:** consolidate the account portal into four task tabs ([784cc59](https://github.com/wolfymaster/woofx3-ui/commit/784cc59d7674788fb17de85e3105272661a95d32))

## [0.9.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.8.0...woofx3-v0.9.0) (2026-11-14)

### Features

* **onboarding:** add a duck game on the finish page's level meter ([484e637](https://github.com/wolfymaster/woofx3-ui/commit/484e637c3ce476e69b867f41f71452e0fc91b577))

### Reverts

* **onboarding:** bring back the animated level meter, drop the duck game ([ef77f56](https://github.com/wolfymaster/woofx3-ui/commit/ef77f56fde8e2130255e506ff170d466d0b38757))

## [0.8.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.7.0...woofx3-v0.8.0) (2026-11-13)

### Features

* **marketplace:** buy every listing through the billing plane ([d0669c9](https://github.com/wolfymaster/woofx3-ui/commit/d0669c9efc1a089fc48cd8cebc174bdee34ea150))
* **onboarding:** give the wait room a duck game and a fake chat ([edfba31](https://github.com/wolfymaster/woofx3-ui/commit/edfba31ef5833c2ed86508758be51923d87a9314))
* **onboarding:** let the finish wait go back to the overlay and announce readiness ([bd41d73](https://github.com/wolfymaster/woofx3-ui/commit/bd41d7351363ff8e36651e8b9789f28bd2771475))
* **onboarding:** make the finish wait a wait room with scene prep to do ([8716948](https://github.com/wolfymaster/woofx3-ui/commit/87169482bdc46e44342d68fddd7e8a27fe78304f))
* **onboarding:** open the dashboard while the engine starts, with a status and a gated body ([df36b8b](https://github.com/wolfymaster/woofx3-ui/commit/df36b8bd260d0dc0887f7155a1cac3c459b3bbeb))
* **onboarding:** say what the engine build is doing and how long it has been ([e8ae8a2](https://github.com/wolfymaster/woofx3-ui/commit/e8ae8a21a003b7acbe5014193d0250bc89547038))

### Bug Fixes

* **onboarding:** let an invitee set up their own engine ([ca134c4](https://github.com/wolfymaster/woofx3-ui/commit/ca134c446699c8243b8827880db1fe51a6b4093a))

## [0.7.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.6.0...woofx3-v0.7.0) (2026-11-11)

### Features

* **marketplace:** ask for install approval from the listing's declarations ([67ee0d9](https://github.com/wolfymaster/woofx3-ui/commit/67ee0d96c5111d4238b6c3c64fd051b3195a08d5))
* **marketplace:** install through a license on engines that take keys ([dcfe4fe](https://github.com/wolfymaster/woofx3-ui/commit/dcfe4fe5278b96d9a515f8785cef92d39f97c82a))
* **marketplace:** only the account owner starts a payment ([fbd55a4](https://github.com/wolfymaster/woofx3-ui/commit/fbd55a4bdd8764351c9c4a13c541929574840450))
* **marketplace:** pay for a module through billing and follow the payment back ([1e9f4d1](https://github.com/wolfymaster/woofx3-ui/commit/1e9f4d1ab1583813393b75e95c81b9a9f6beacae))
* **modules:** only owners and admins see a module's license key ([2c04ddf](https://github.com/wolfymaster/woofx3-ui/commit/2c04ddf79abfb4e974f3257093eb935e10f5c15f))
* **modules:** show an installed module's license key, hidden until asked ([8754ead](https://github.com/wolfymaster/woofx3-ui/commit/8754ead1bb753255cce66c56cead99322a88da1a))

### Bug Fixes

* **billing:** ask for a checkout's state as the organization it is for ([f1bac91](https://github.com/wolfymaster/woofx3-ui/commit/f1bac91b1c5ea5e740d8a60ccc9660b25294915b))
* **engine:** name the role type in engine types, not Convex's ([53a1203](https://github.com/wolfymaster/woofx3-ui/commit/53a1203d8fa8d77cff7a184c4ed23aa99f1b9945))
* **marketplace:** follow a purchase on the engine that opened it ([8b15bc3](https://github.com/wolfymaster/woofx3-ui/commit/8b15bc3f193da1ad7afaac5fc1db2f318994e64c))
* **marketplace:** gate purchases and license keys on the organization role ([87ef969](https://github.com/wolfymaster/woofx3-ui/commit/87ef9695d166ddf57621cacbefbc383f0a81e381))
* **marketplace:** read the caller's role through the engine gateway ([83733e1](https://github.com/wolfymaster/woofx3-ui/commit/83733e14987439a9f0efb10ddf9d1d87b460960f))

## [0.6.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.5.0...woofx3-v0.6.0) (2026-11-10)

### Features

* **access:** the dashboard needs an engine ([978fbdd](https://github.com/wolfymaster/woofx3-ui/commit/978fbdde647d4694612a693ed413439fbdb5b7d3))
* **billing:** call the management plane for checkout, portal and invoices ([b86adac](https://github.com/wolfymaster/woofx3-ui/commit/b86adac906be6348b8d2aea801eb03c9d3ac8161))
* **billing:** finish checkout on the return page ([8e86925](https://github.com/wolfymaster/woofx3-ui/commit/8e86925f1cb67a1bead9c6e4260fc613f5fbae23))
* **billing:** payment provider adapter with Stripe ([d1a8d1a](https://github.com/wolfymaster/woofx3-ui/commit/d1a8d1a68de3fe8d4440fbf880814791f60c21fd))
* **billing:** warn the owner in-app and by email ([3c02dc4](https://github.com/wolfymaster/woofx3-ui/commit/3c02dc44a3f9a14ef8fa04384188a511c03f68ea))
* **entitlements:** availability, plan, state and add-ons ([ce3132e](https://github.com/wolfymaster/woofx3-ui/commit/ce3132ea62070ed7d80bab0cd372215a1e205cb1))
* **invites:** an invitation grants one engine ([08498bc](https://github.com/wolfymaster/woofx3-ui/commit/08498bca6c5fc0a42a98bc2bd6ed94d4394f8c89))
* **onboarding:** start the trial before the engine is built ([61d482a](https://github.com/wolfymaster/woofx3-ui/commit/61d482ad427f3e016bdf1f48c15646ee30152c55))
* **org-portal:** organization and billing pages at /org ([bcde52a](https://github.com/wolfymaster/woofx3-ui/commit/bcde52a60675a1fd82f9d2716268beaca8222d84))
* **org-portal:** remove "Create another engine" from the Engines page ([4077218](https://github.com/wolfymaster/woofx3-ui/commit/40772186fc2380f01dbdd5208d86380ccbd91922))
* **org-portal:** send ?start=trial without an engine to onboarding ([4e3bf1c](https://github.com/wolfymaster/woofx3-ui/commit/4e3bf1cbd26db7e580f2cf379077e86ad6fca710))
* **org:** only the owner creates engines ([bfd5dbb](https://github.com/wolfymaster/woofx3-ui/commit/bfd5dbbee147ca27380be1f6249f85d1f9d32942))
* **settings:** personal settings page ([ddb1584](https://github.com/wolfymaster/woofx3-ui/commit/ddb1584de3da98c76b527999720e7281ba492814))
* **team:** show member emails to the org owner only, masked by default ([b8cde22](https://github.com/wolfymaster/woofx3-ui/commit/b8cde22304979cc1da34fb63c488ec8cca64a29f))
* **team:** team lists this engine's members ([f59b1cf](https://github.com/wolfymaster/woofx3-ui/commit/f59b1cf715f9dff02fc7aba6d5ab3b39aef7834c))
* **ui:** engine switcher in the profile menu ([3e00cb5](https://github.com/wolfymaster/woofx3-ui/commit/3e00cb54d81740cfa8ba52215b4222479dc9ef80))
* **ui:** rename the engine in Engine Settings ([9f66c0b](https://github.com/wolfymaster/woofx3-ui/commit/9f66c0bf9c551a3b819357026312af729731cdd2))

### Bug Fixes

* **accept-invite:** log an unexpected accept failure with its request id ([fceabba](https://github.com/wolfymaster/woofx3-ui/commit/fceabba6e0154f2470821f72b11db61e4b8d24c8))
* **access:** type the suspended reason from the entry ([3c98c6c](https://github.com/wolfymaster/woofx3-ui/commit/3c98c6cdb891d823a1d8b3bf61b8d5d119859f42))
* **billing:** refuse checkout while an operator suspends the org ([51f2788](https://github.com/wolfymaster/woofx3-ui/commit/51f2788f57c1646336aae51e6fd2a31b3a7e88d3))
* **billing:** retry ensure on the Convex scheduler and sharpen checkout copy ([5ad80c3](https://github.com/wolfymaster/woofx3-ui/commit/5ad80c335d86857bbc44c497b79d6164f6e2bf32))
* **billing:** send a failing subscription to the portal, not checkout ([ef305b4](https://github.com/wolfymaster/woofx3-ui/commit/ef305b4c2acb83ac81e91a2a7dfe2b17483d52da))
* **copy:** point at the profile menu's engine switch, not a workspace ([647e07c](https://github.com/wolfymaster/woofx3-ui/commit/647e07ce7ae40d3533b9b7c3ea4458210442cc60))
* **deps:** bump convex to 1.46+ for the migrations runner ([44377fd](https://github.com/wolfymaster/woofx3-ui/commit/44377fdcf8240319747d411de1b9f3fc0e9ea42b))
* **entitlements:** pass the clock into queries that resolve entitlements ([928b54b](https://github.com/wolfymaster/woofx3-ui/commit/928b54bb6e652a46b0e81f73b800654277127f07))
* **invitations:** answer full seats and wrong account on accept as outcomes ([0be6d32](https://github.com/wolfymaster/woofx3-ui/commit/0be6d32f3b6eecdca7342bed39805ed80c626eaf))
* **invites:** accept answers expected outcomes as values and the page explains them ([ef7e342](https://github.com/wolfymaster/woofx3-ui/commit/ef7e342f54f1a716e3cbd3e1500de8d0e08688bc))
* **onboarding:** keep the plan prompt outside the org portal's build boundary ([c72f5be](https://github.com/wolfymaster/woofx3-ui/commit/c72f5be7496670a0b46fd4f83e304e9e555986e1))
* **org-portal:** start a trial only for someone on no engine ([3c2303d](https://github.com/wolfymaster/woofx3-ui/commit/3c2303d876fe772696fe55bd9665901452be9f83))
* **orgs:** show no seat limit for orgs with only self-hosted engines ([c8ced25](https://github.com/wolfymaster/woofx3-ui/commit/c8ced25bd57121bf378ff962b350cda67d40f998))
* **portal:** handle a billing projection with no plan or a labelled discount ([2c691e6](https://github.com/wolfymaster/woofx3-ui/commit/2c691e6580a8807cfe5f7a5afe4e917a4f72f2c4))
* **settings:** clear the password error when either field is edited ([ef080c6](https://github.com/wolfymaster/woofx3-ui/commit/ef080c6bc05bb02dae47d782a68facf8d2b86a30))
* **settings:** tell a rate-limited password change from a wrong one ([af5c23b](https://github.com/wolfymaster/woofx3-ui/commit/af5c23b11beee6af0379fa75ccc92fc678a04700))
* **team:** gate the invite page on the engine-admin check the server enforces ([1df0739](https://github.com/wolfymaster/woofx3-ui/commit/1df0739a3850cf5513661fc43abf7e0f534aad73))
* **team:** keep the email toggle label stable and name the mask ([47c7002](https://github.com/wolfymaster/woofx3-ui/commit/47c7002285bf7756cfe864bf78f7086e2db55c8d))
* **team:** pass the clock into invitations.listForEngine ([af5a0f8](https://github.com/wolfymaster/woofx3-ui/commit/af5a0f8c10f2588021eb963a728a450d6d3e227e))
* **team:** show refusal messages instead of request ids ([8d062bb](https://github.com/wolfymaster/woofx3-ui/commit/8d062bbbefabd058885273f531a00f44eba7e245))
* **ui:** cap engine names at 100 characters ([ebc7e38](https://github.com/wolfymaster/woofx3-ui/commit/ebc7e389367a8d3f845e09d1399b2108eb7fe49f))
* **ui:** show a coded ConvexError's message ([df79c5d](https://github.com/wolfymaster/woofx3-ui/commit/df79c5d6a228f5609ec8a57959c6752d5d43dbe3))

## [0.5.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.4.0...woofx3-v0.5.0) (2026-11-10)

### Features

* **desktop:** move update toast to top right, add dismiss and header icon ([c597377](https://github.com/wolfymaster/woofx3-ui/commit/c59737741df6e764bcf7e641c1c7794c7a9c0b1e))

### Bug Fixes

* **client:** read the header user without casting to any ([da86633](https://github.com/wolfymaster/woofx3-ui/commit/da86633bf74bba7e4fa2d5682f5cd203d24b7933))
* **desktop:** drop the static "On this computer" label from the local header ([ab1f4d6](https://github.com/wolfymaster/woofx3-ui/commit/ab1f4d62bc5c6e28d301151979618d941762d696))
* **marketplace:** keep only http(s) author and credit links ([6a6b21d](https://github.com/wolfymaster/woofx3-ui/commit/6a6b21d8ab6ec21d86cf3e896f2e775ece89d580))
* **modules:** bundle Monaco so the file viewer loads under the desktop CSP ([8e25f71](https://github.com/wolfymaster/woofx3-ui/commit/8e25f715ee40bda328fbbdf5f686de94ecf27376))

### Performance Improvements

* **convex:** send the alert list only the fields its readers use ([099514f](https://github.com/wolfymaster/woofx3-ui/commit/099514f2595d2f1119c3cf1d36f019d083cce504))

## [0.4.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.3.0...woofx3-v0.4.0) (2026-11-09)

### ⚠ BREAKING CHANGES

* **convex:** remove pairing a companion with a code

### Code Refactoring

* **convex:** remove pairing a companion with a code ([fa555f4](https://github.com/wolfymaster/woofx3-ui/commit/fa555f48dd83a215efc1d0e9838cf9069e0355b9))

## [0.3.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.2.2...woofx3-v0.3.0) (2026-11-07)

### Features

* **layout:** open the section from a header menu on phones ([d459ced](https://github.com/wolfymaster/woofx3-ui/commit/d459ced2da5a7b0506260255a494ca2fae4933c7))
* **layout:** show list or detail, not both, on phones ([7271957](https://github.com/wolfymaster/woofx3-ui/commit/7271957c23f169f4222cfad87ee0688ac3221333))

### Bug Fixes

* **admin:** list YouTube and Discord as coming soon, not connectable ([64f75c5](https://github.com/wolfymaster/woofx3-ui/commit/64f75c59ef2cd45a3860e8c2d40b6af23b698148))
* **admin:** sentence-case section titles and describe engine sync plainly ([52135a5](https://github.com/wolfymaster/woofx3-ui/commit/52135a5209565f850d3c42603e0a11b1e2b03061))
* **alerts:** quiet the platform headers and stop the test form scrolling ([fb4c7ba](https://github.com/wolfymaster/woofx3-ui/commit/fb4c7baf6e5294a54a912bf7689a5e246685802b))
* **dashboard:** line panels up with the bar above and shorten the macro hint ([b29b289](https://github.com/wolfymaster/woofx3-ui/commit/b29b289125956b80bcda2a64deecb2e0bbd19af7))
* **feedback:** sort with the same segmented switch as other lists ([45f282f](https://github.com/wolfymaster/woofx3-ui/commit/45f282ff0a47f4bd0340e37aa070984eb492079e))
* **layout:** fit the dashboard and list pages on a phone ([b2dc463](https://github.com/wolfymaster/woofx3-ui/commit/b2dc463071c8b86ee1a3f848d5d01ae5dadc64ad))
* **layout:** name Ctrl, not Command, in the quick actions hint off Apple ([52cfb28](https://github.com/wolfymaster/woofx3-ui/commit/52cfb28a9d69e100c73b3edf4a8a1f65ca26e08e))
* **layout:** time the phone section menu like the app's other sheets ([1c9de4c](https://github.com/wolfymaster/woofx3-ui/commit/1c9de4c82e805daed339b3af896d2220e925edc0))
* **marketplace:** keep hero copy off the art and banners uncropped ([5cbd11f](https://github.com/wolfymaster/woofx3-ui/commit/5cbd11fcac52f929eef7ba9e984e99af155976b9))
* **marketplace:** shape banner art to the rendition it shows ([d7f8fb0](https://github.com/wolfymaster/woofx3-ui/commit/d7f8fb019ac1bf5a2bfa792178ce36e2e7374717))
* **marketplace:** show featured and category banners uncropped at 16:9 ([967eb15](https://github.com/wolfymaster/woofx3-ui/commit/967eb151e793bf566197de8f30f035842752b4fd))
* **nav:** keep the entries nested under Alerts visible on every page ([f36fb4d](https://github.com/wolfymaster/woofx3-ui/commit/f36fb4d3bb6886044f7b61d0fd283734680562f8))
* **scenes:** give counter, timer, queue and database widgets their icons ([3045f58](https://github.com/wolfymaster/woofx3-ui/commit/3045f581086166b0561f5b852721833a09c086a8))
* **scenes:** keep the widget placeholder's label readable at any zoom ([8270dae](https://github.com/wolfymaster/woofx3-ui/commit/8270dae3677703ffa889fca64fbda49d950dfca4))
* **scenes:** label autosave as a draft and Publish as going live ([20dc994](https://github.com/wolfymaster/woofx3-ui/commit/20dc9949fef22f556fc6996c2e699878e07d868a))
* **setup:** write the connect page's heading in sentence case ([b1439fb](https://github.com/wolfymaster/woofx3-ui/commit/b1439fb143ca87f2df905451f440ec19b64cd930))
* **starter-packs:** quiet the per-card buttons and stop repeating the block reason ([bfaf2b0](https://github.com/wolfymaster/woofx3-ui/commit/bfaf2b06803897e8ad399671d105d5f803cd7d5a))
* **ui:** drop the page intro's button that repeats the page's own action ([aacbc76](https://github.com/wolfymaster/woofx3-ui/commit/aacbc768fb35dbdc305685aeaa2a088fe2de028d))
* **ui:** empty states say what is missing and stop repeating the page button ([cd48cde](https://github.com/wolfymaster/woofx3-ui/commit/cd48cde9b8692a604625cc4f5a1233a4f90a9c62))
* **ui:** grey out row delete icons until hovered ([0521d21](https://github.com/wolfymaster/woofx3-ui/commit/0521d21542caa44d80d8a6824df90003ea3e726a))
* **ui:** honour reduced motion across the app ([d498b56](https://github.com/wolfymaster/woofx3-ui/commit/d498b56795c39f1a4cfb1811e34d9c1bf08f9126))
* **ui:** make section card titles smaller than the page title ([8898dcd](https://github.com/wolfymaster/woofx3-ui/commit/8898dcdcfb1fa1a2fd7c9f1511f2adf8168455fd))
* **ui:** open side sheets in 300ms instead of 500ms ([fc063d5](https://github.com/wolfymaster/woofx3-ui/commit/fc063d5d29e6d090df38df1696e522d8f7e18fe8))
* **ui:** write the remaining Title Case dialog titles in sentence case ([ed4b079](https://github.com/wolfymaster/woofx3-ui/commit/ed4b0799cecadf432d5eda6aef64e2bb48d5be8b))
* **workflows:** keep the editor header readable on a phone ([f068eff](https://github.com/wolfymaster/woofx3-ui/commit/f068eff0356febc38da6f9428f568214cc1f5966))
* **workflows:** quiet the header Save when nothing is unsaved ([c146c96](https://github.com/wolfymaster/woofx3-ui/commit/c146c96945b1b3a4806aef42071fe04b4276913e))
* **workflows:** wrap the editor header's actions on a phone ([c036d50](https://github.com/wolfymaster/woofx3-ui/commit/c036d50fa233217bcf3675057cba4f0954a15927))

## [0.2.2](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.2.1...woofx3-v0.2.2) (2026-11-07)

### Bug Fixes

* **alerts:** read wildcard-named events through their trigger ([1c23f22](https://github.com/wolfymaster/woofx3-ui/commit/1c23f2215d7bb6e73fb5f44b9b6b43e45516b196))
* **desktop:** bundle engine v0.68.4 ([8925ea2](https://github.com/wolfymaster/woofx3-ui/commit/8925ea2c0934703cef102cd04dbc67d5c560e447))
* **scenes:** keep the preview's widgets running when toggling Live Update ([1acdcad](https://github.com/wolfymaster/woofx3-ui/commit/1acdcad46b221454fa642c1688284a7bfa9fe506))

## [0.2.1](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.2.0...woofx3-v0.2.1) (2026-11-06)

### Bug Fixes

* **desktop:** bundle engine v0.68.2 ([99a87c2](https://github.com/wolfymaster/woofx3-ui/commit/99a87c2572f7aea9e3af34f59c6e0bfdde000f76))

## [0.2.0](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.1.6...woofx3-v0.2.0) (2026-11-06)

### ⚠ BREAKING CHANGES

* **desktop:** remove the companion window and pairing with a code

### Features

* **desktop:** give local mode the first run hosted setup has ([95c15a4](https://github.com/wolfymaster/woofx3-ui/commit/95c15a48001700f641e6ae97576ab4ad1ab816bc))
* **desktop:** offer a ready update in the dashboard ([35f0950](https://github.com/wolfymaster/woofx3-ui/commit/35f0950c441efdc7b882efb4ecb09ce8c4f87341))

### Bug Fixes

* **alerts:** hide raw event ids in the test-alert picker ([ece0647](https://github.com/wolfymaster/woofx3-ui/commit/ece06477343672289d12f42494c75932fd9755f3))
* **databases:** edit a yes/no cell with a switch ([e4287a8](https://github.com/wolfymaster/woofx3-ui/commit/e4287a8c4377fa2f28f7fa67c60b3f889401214a))
* **desktop:** grant the dashboard open_external_url ([82817e8](https://github.com/wolfymaster/woofx3-ui/commit/82817e87e0d66d26ac97cf03cfd0a7dd021f4016))
* **desktop:** keep why a link could not be parsed ([64f732f](https://github.com/wolfymaster/woofx3-ui/commit/64f732f15104b64837d523246f529433366d4f10))
* **desktop:** open web pages from the dashboard in the system browser ([7082455](https://github.com/wolfymaster/woofx3-ui/commit/7082455f8cea261d27e8bed46954a8ec9bec4971))
* **desktop:** send links that leave the app to the system browser ([4512cbd](https://github.com/wolfymaster/woofx3-ui/commit/4512cbdcd88ee0bb521d86d36a4f42750733c324))
* **desktop:** show Admin as the header's utility icon in local mode ([566696f](https://github.com/wolfymaster/woofx3-ui/commit/566696fa242402e5c4a09ecd87f4707ef2e55180))
* **forms:** open the save-to-database dialog on the current database ([085823c](https://github.com/wolfymaster/woofx3-ui/commit/085823c872fca56c45a970f80d769c7fafc5813c))
* **forms:** reuse a database column named like the question ([c4185a9](https://github.com/wolfymaster/woofx3-ui/commit/c4185a91854a88bb716e7180922933b5a3759200))
* **moderation:** show a bad phrase only beside the phrase ([23870c2](https://github.com/wolfymaster/woofx3-ui/commit/23870c2ae8c8ae58156592ecb73733f35b6104d9))
* **resources:** name databases and forms instead of showing their ids ([a76a9bf](https://github.com/wolfymaster/woofx3-ui/commit/a76a9bf05c710c3e935b101550146a2c758c3d8e))
* **ui:** say trigger, not workflow, on the screens that just shipped ([0adac11](https://github.com/wolfymaster/woofx3-ui/commit/0adac11c0ec8c9c18151b062fe659bd198165ac0))

### Code Refactoring

* **desktop:** remove the companion window and pairing with a code ([7570457](https://github.com/wolfymaster/woofx3-ui/commit/75704576ef5c15c18b792914d4be80c69d8e1457))

## [0.1.6](https://github.com/wolfymaster/woofx3-ui/compare/woofx3-v0.1.5...woofx3-v0.1.6) (2026-11-05)

### Bug Fixes

* **desktop:** reach Admin and Integrations from local mode ([8bf348e](https://github.com/wolfymaster/woofx3-ui/commit/8bf348e001323a07ad9dd581cf8c7d3e43be3fc6))
