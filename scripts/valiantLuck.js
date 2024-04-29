Hooks.on("midi-qol.preCheckHits", spendLuckMidi )
Hooks.on("midi-qol.AttackRollComplete",addLuckMidi)
Hooks.on("midi-qol.postCheckSaves", addLuckMidi)
Hooks.on("midi-qol.preCheckSaves", spendLuckMidi)
//Hooks.on("dnd5e.preRollAbilitySave", spendLuckVanilla)
//Hooks.on("dnd5e.preRollAbilityTest", spendLuckVanilla)
//Hooks.on("dnd5e.preRollSkill", spendLuckVanilla)
//Hooks.on("dnd5e.preRollDeathSave", spendLuckVanilla)


async function spendLuckMidi(workflow){
    console.log(workflow)

	let actor = workflow.actor
    let item = actor.items.find(item => item.name === "Luck");
    if ( item === undefined){
        return;
    }
    let luckTotal = item.system.uses.value
	if(luckTotal > 0) {
	    //Generate our Dialog
	    let luckSpend= await showDialog(workflow.diceRoll, luckTotal);
        if(luckSpend === "skip"){
            return;
        }
        //Pull values from object
        let reRoll=luckSpend.reRoll;
        let luckCount=luckSpend.luckCount;
        //Grab our current roll
        let expr = workflow.attackRoll.formula;
        let newExpr = expr.substring(expr.indexOf("+"));
        //if the choice was to re-roll
        if (reRoll) {
            let newAttackRoll = new game.system.dice.D20Roll(`{1d20 , ${workflow.diceRoll}}kh ${newExpr}`);
            await newAttackRoll.evaluate();
            game.dice3d?.showForRoll(newAttackRoll);
            workflow.setAttackRoll(newAttackRoll);
            workflow.processAttackRoll();
        } else {
            let newAttackRoll = new game.system.dice.D20Roll(`${workflow.diceRoll} ${newExpr} + ${luckCount}`);
            await newAttackRoll.evaluate();
            workflow.setAttackRoll(newAttackRoll);
            workflow.processAttackRoll();
        }
        subtractLuck(actor, luckCount);
    }
}


async function addLuckMidi(workflow){
    //If we did not hit at least one target
    if( workflow.hitTargets.size === 0){
        let actor = workflow.actor
        let item = actor.items.find(item =>  item.name === "Luck");
        if ( item === undefined){
            return;
        }
        let luckTotal = item.system.uses.value
        await addLuck(actor, luckTotal);
    }
}

async function addLuck(actor, luckTotal){
    let item = actor.items.find(item =>  item.name === "Luck");
    if ( item === undefined){
        return;
    }
    //check if the actor has already recieved luck this turn
    let effect = actor.effects.find(effect =>  effect.name === "AlreadyLucky");
    if ( !(effect === undefined)){
        return;
    }
    // less than max luck, just add
    if(luckTotal < 5){
        await item.update({'system.uses.value': luckTotal + 1});
    } else {
        let newRoll = new Roll("1d4");
        await newRoll.evaluate();
        newRoll.toMessage({title:"Luck Reset", flavor:`${actor.name} has too much Luck, Resetting`});
        await item.update({'system.uses.value': newRoll.result});
    }
    //Add effect to prevent luck from happening again
    let bsEffect = new ActiveEffect({label:"AlreadyLucky", icon:"icons/commodities/flowers/clover.webp", duration:{turns:1}})
    await MidiQOL.socket().executeAsGM("createEffects", {actorUuid: actor.uuid, effects: [bsEffect.toObject()]})
}

async function subtractLuck(actor, luckCount){
    let item = actor.items.find(item =>  item.name === "Luck");
    if ( item === undefined){
        return;
    }
    let luckTotal=item.system.uses.value;
    if(luckTotal - luckCount < 0){
        luckTotal = luckCount;
    }
    await item.update({"system.uses.value":luckTotal-luckCount});
}

function spendLuckVanilla(actor, rollConfig){
    let item = actor.items.find(item =>  item.name === "Luck");
    if ( item === undefined){
        return;
    }
	let luckTotal = item.system.uses.value
	if(luckTotal > 0) {
        //Do initial roll manually
        game.system.dice.d20Roll(rollConfig).then( (roll) => {
            roll.toMessage()
            showDialog(roll.total, luckTotal).then((luckSpend) => {
                if(luckSpend === "skip"){
                    return;
                }
                let reRoll=luckSpend.reRoll;
                let luckCount=luckSpend.luckCount;

                if (reRoll){
                    rollConfig.flavor = rollConfig.flavor + " (Luck - Reroll)"
                    let formula = [`{1d20, ${roll.dice[0].total}}kh`].concat(rollConfig.parts).join(" + ");
                    let newRoll = new game.system.dice.D20Roll(formula, rollConfig.data, rollConfig);
                    newRoll.evaluate({async:true}).then((res) => {
                        res.toMessage()
                    });
                } else {
                    rollConfig.flavor = rollConfig.flavor + " + Luck"
                    let formula = `${roll.result} + ${luckCount}`;
                    let newRoll = new game.system.dice.D20Roll(formula, {}, rollConfig);
                    newRoll.evaluate({async:true}).then((res) => {
                        res.toMessage()
                    });
                }
                subtractLuck(actor, luckCount);
            })        
            
        }); 
        return false;
    }
}

async function showDialog(diceRoll, luckTotal) {
    let dialogText = `
          <h3>Current Roll:${diceRoll}<h3>
          <form class="flexcol">
              <div class="form-group">
                  0&nbsp;<input type="range" min="0" max="${luckTotal}" step="1" id="luckcount" name="luckcount">&nbsp;${luckTotal}
                  </input>`;
    if (luckTotal >= 3) {
        dialogText += `
                  <input type="checkbox" id="reroll" name="reroll">
                  </input>
                  <label for="reroll">Re-Roll?</label>`;
    }
    dialogText += `
              </div>
          </form>`;

    let reRoll;
    if(luckTotal < 3){
        reRoll=false;
    }
    let luckCount;
    let skip = false;
    //Show the dialog
    let dialog = new Promise((resolve, reject) => {
        new Dialog({
            title: 'Spend Luck Points?',
            content: dialogText,
            //select element type
            buttons: {
                submit: {
                    icon: '<i class="fas fa-bolt"></i>',
                    label: 'Yes',
                    callback: async (html) => {
                        const formElement = html[0].querySelector('form');
                        const formData = new FormDataExtended(formElement);
                        const formDataObject = formData.object;
                        luckCount = formDataObject.luckcount;
                        reRoll = formDataObject.reroll;
                        if(reRoll){
                            luckCount=3;
                        }
                        resolve();
                    },
                },
                cancel: {
                    label: "No",
                    callback: async (html) => {
                        skip=true;
                        resolve();
                    } 
                },
            },
        }).render(true);
    });    
    await dialog;
    if(skip){
        return "skip"
    }
    let ret = {reRoll: reRoll , luckCount:luckCount};
    return ret;
}



