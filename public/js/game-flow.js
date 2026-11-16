import { isCharacterId } from './characters.js';
export class GameFlow {
  constructor(characterId) {
    this.characterId=isCharacterId(characterId)?characterId:'kitten';
    this.pendingSelection=null;this.page='welcome';this.control='keyboard';this.mode='solo';this.roundSeen=false;
  }
  select(id){if(!isCharacterId(id))return false;this.characterId=id;return true;}
  requestSelection(id,now){if(!this.select(id))return false;this.pendingSelection={id,at:now};return true;}
  reconcileSelection(id,now){
    if(!isCharacterId(id))return false;
    if(this.pendingSelection?.id===id)this.pendingSelection=null;
    if(this.pendingSelection && now-this.pendingSelection.at<1200)return false;
    this.pendingSelection=null;
    if(id!==this.characterId){this.select(id);return true;}
    return false;
  }
  next(){this.page=this.page==='welcome'?'characters':'setup';}
  back(){this.page=this.page==='setup'?'characters':'welcome';}
  canEnter({connected,characterId,assetReady,leftConnected,rightConnected}){
    return !!(connected&&characterId===this.characterId&&assetReady&&(this.control!=='phone'||(leftConnected&&(this.mode!=='duo'||rightConnected))));
  }
  enter(){this.page='match';this.roundSeen=false;}
  lobby(){this.page='characters';this.roundSeen=false;}
  observe(s){
    if(this.page==='match' && typeof s.right?.ai==='boolean')this.mode=s.right.ai?'solo':'duo';
    if(this.page!=='match')return false;
    if(s.phase!=='over'){this.roundSeen=true;return false;}
    if(!this.roundSeen)return false;
    this.page='result';return true;
  }
}
