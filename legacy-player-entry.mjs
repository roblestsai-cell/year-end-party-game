// The only legacy index change is loading this module instead of bootstrap.js.
// No SDK/auth/RPC starts before the routing decision. Existing host path is retained.
import {config} from './config.js';
import {validateConfig} from './adapter.js';
import {readSavedRole,legacyPlayerTarget} from './player-entry-contract.mjs';
let target=null;
try{validateConfig(config);target=legacyPlayerTarget(location.hash,readSavedRole(sessionStorage,config),location.href);}catch{/* Let unchanged legacy bootstrap fail closed on its existing configuration/storage checks. */}
if(target)location.replace(target);else await import('./bootstrap.js');
