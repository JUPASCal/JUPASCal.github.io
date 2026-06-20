(()=>{let e="jupas-calculator.jupas-calculator";Drupal.behaviors[e]={attach:(t,r)=>{once(e,".page--node--jupas-calculator").forEach(e=>{(function(){let e=document.getElementById("facility-select"),t=document.getElementById("programme-select"),r=document.getElementById("jupas-reset-button"),c=document.getElementById("jupas-calculate-button"),l=document.getElementById("add-elective-subject-button"),a=document.getElementById("add-other-language-button"),o=new Set,n=new Map,s={},i=new showdown.Converter({extensions:[{type:"output",filter:function(e,t){return e=e.replace(/<\/?p[^>]*>/gi,"")}}],tables:!0}),u=new showdown.Converter({tables:!0}),d={},m=document.getElementById("programme-select");/**
   * Get the programme weight by the jupas code. This also shows or hide the calculator display
   * depends on the weight table exists for the jupus code.
   *
   * @param jupasCode
   * @returns {*[]|*}
   */function b(e){return(// todo show/hide should be refactored to where else
d.data.hasOwnProperty(e)?(document.querySelector(".jupas-calculator").classList.remove("hidden"),document.querySelector(".programme-detail").classList.remove("hidden"),d.data[e]):(document.querySelector(".jupas-calculator").classList.add("hidden"),document.querySelector(".programme-detail").classList.add("hidden"),[]))}/**
   * Resets the calculator values.
   */function p(){let e=b(t.value);_(e),/**
   * Reset all the non-core subject rows back to it default values.
   */function(){let e=/**
   * Return keys for non-core categories.
   *
   * @returns {string[]}
   */function(){let e=Object.keys(d.subject_category);return e.filter(e=>"core_subject"!==e)}();// Remove additional input rows.
for(let t of e){let e=t.replaceAll("_","-"),r="#calc-"+e+" .calc-row",c=document.querySelectorAll(r),l=c.length-parseInt(d.starting_row_count[t]);for(let e=0;e<l;e++)c[e].remove()}// Reset subjects
let t=document.querySelectorAll(".calc-item-subject");for(let e of t)e.selectedIndex=0;// Reset Levels
let r=document.querySelectorAll(".calc-item-level");for(let e of r)e.selectedIndex=0;// Reset Weight.
let c=document.querySelectorAll(".calc-item-weight");for(let e of c)e.innerHTML="";// Reset core subject levels
let l=document.querySelectorAll("#calc-core-subject .calc-row");for(let e of l){let t=e.querySelectorAll(".calc-item"),r=t[0].innerText,c=k(r);r===H("core_subject_4")&&(c=A(d.liberal_studies_attained,k(r))),t[1].querySelector(".core-subject-level").value=c}// Reset score.
let a=document.querySelectorAll(".calc-item-score");for(let e of a)e.innerHTML="0";// Reset validation error.
let o=document.getElementById("calculate-messages-wrapper");o.innerHTML="",o.classList.add("hidden");// Reset Total score.
let n=document.getElementById("calculate-result-wrapper");n.classList.add("hidden")}(),S(),E(),T()}/**
   * Populates the programme details display.
   *
   * @param admissions
   * @param jupasCode
   */function g(e,t){let r=d.data.ADMISSIONS.find(e=>e[d.header.programmes.jupas_code]===t);if(r){let e=document.getElementById("prog-name"),c=document.getElementById("prog-jupas-code"),l=document.getElementById("prog-quota"),a=document.getElementById("prog-calc-mechanism"),o=document.getElementById("prog-preferred-subject-wrapper"),n=document.getElementById("prog-preferred-subject"),s=document.getElementById("prog-relavent-subject-wrapper"),i=document.getElementById("prog-relevant-subject"),m=document.getElementById("prog-remarks"),b=document.getElementById("prog-remarks-wrapper");e.innerHTML=r[d.header.programmes.programme],c.innerHTML=c?r[d.header.programmes.jupas_code]:"",l.innerHTML=r[d.header.programmes.quota],a.innerHTML=r[d.header.programmes.calculation_mechanism];let p=r[d.header.programmes.preferred_subject];null!==p&&""!==p?(o.classList.remove("hidden"),n.innerHTML=u.makeHtml(p)):o.classList.add("hidden");let g=r[d.header.programmes.relevant_subject];null!==g&&""!==g?(s.classList.remove("hidden"),i.innerHTML=u.makeHtml(g)):s.classList.add("hidden");let _=r[d.header.programmes.remarks];null!==_&&""!==_?(b.classList.remove("hidden"),m.innerHTML=u.makeHtml(_)):b.classList.add("hidden"),document.querySelector(".view-more-information").innerText=d.label.view_more_information_label,document.querySelector(".button-interview-arrangement > a").innerText=d.label.interview_arrangement_button,document.querySelector(".button-interview-arrangement > a").setAttribute("href",d.label.interview_arrangement_button_url.formatUnicorn({jupas_code:t})),document.querySelector(".button-programme-details > a").innerText=d.label.programme_details_button,document.querySelector(".button-programme-details > a").setAttribute("href",d.label.programme_details_button_url.formatUnicorn({jupas_code:t.toLowerCase()}))}}/**
   * Creates the core subject rows base on the requirement configuration.
   *
   * @param weightTable
   */function _(e){x("core_subject");let t=document.getElementById("calc-core-subject");for(let r of d.requirements.filter(e=>"core_subject"===e.category))t.appendChild(/**
   * Create a single subject row DOM element for core subjects.
   *
   * @param subject
   * @param weightTable
   * @returns {HTMLDivElement}
   */function(e,t){let r=document.createElement("div");r.classList.add("calc-row"),r.classList.add("calc-grid");let c=document.createElement("div");c.classList.add("calc-item"),c.classList.add("core-subject"),c.innerText=e;let l=document.createElement("div");l.classList.add("calc-item"),l.classList.add("core-subject");let a=document.createElement("select");a.classList.add("core-subject-level"),a.classList.add("calc-item-level"),a.setAttribute("name","core-subject-level[]"),a.required=!0,l.appendChild(a);let o=document.createElement("div");o.classList.add("calc-item"),o.classList.add("core-subject-weight");let n=document.createElement("div");// Handle liberal studies attained level change
if(n.classList.add("calc-item"),n.classList.add("core-subject-score"),M()&&e===H("core_subject_4")){for(let e in d.liberal_studies_attained){let t=document.createElement("option");t.text=d.liberal_studies_attained[e],t.setAttribute("value",e),a.options.add(t)}a.value="attained",a.setAttribute("disabled","disabled"),o.innerHTML="",n.innerText="",l.classList.add("level-span-3"),o.classList.add("hidden"),n.classList.add("hidden")}else{let r=C(d.scores.core_subject,/**
   * Get the core subject key by its name from the requirement config.
   *
   * @param name
   * @returns {string}
   */function(e){let t=d.requirements.find(t=>t.name===e);if(void 0===t)throw Error('Cannot find core subject matching "'+e+'"');return t.key}(e)),c=document.createElement("option");for(let e of(c.text="-",c.setAttribute("value",""),a.options.add(c),r)){let t=document.createElement("option");t.text=e.level,t.setAttribute("value",e.level),a.options.add(t)}if(a.value=k(e),void 0!==t&&t.length>0){let r=t.find(t=>t[d.header.weights.subject]===e),c=r[d.header.weights.weighting];o.innerHTML=c.toString()}n.innerText="0"}return r.appendChild(c),r.appendChild(l),r.appendChild(o),r.appendChild(n),r}(r.name,e))}/**
   * Create a single subject row DOM element for elective subject, applied language subject
   * and other language subject.
   *
   * @param type
   * @param jupasCode
   * @param subjectList
   * @returns {HTMLDivElement}
   */function h(e,t,r){let c=e.replaceAll("_","-"),l=document.createElement("div");l.classList.add("calc-row"),l.classList.add("calc-grid");let a=document.createElement("div");a.classList.add("calc-item");let o=document.createElement("div");o.classList.add("calc-item");let n=document.createElement("select");n.classList.add(c+"-level"),n.classList.add("calc-item-level"),n.setAttribute("name",c+"-level[]"),n.required=!0,o.appendChild(n);let s=document.createElement("div");s.classList.add("calc-item"),s.classList.add("calc-item-weight"),s.classList.add(c+"-weight");let i=document.createElement("div");i.classList.add("calc-item"),i.classList.add("calc-item-score"),i.classList.add(c+"-score"),i.innerText="0";let u=document.createElement("select");if(u.classList.add(c),u.classList.add("calc-item-subject"),u.setAttribute("name",c+"[]"),u.required=!0,r.length>0){// Populate options.
let e=document.createElement("option");for(let t of(e.text="Select a Subject",e.setAttribute("value",""),u.options.add(e),r)){let e=document.createElement("option");e.text=t[d.header.weights.subject],e.setAttribute("value",t[d.header.weights.subject]),u.options.add(e)}}a.appendChild(u);let m=document.createElement("option");m.text="-",m.setAttribute("value",""),n.options.add(m);let b=C(d.scores[e],e);for(let e of b){let t=document.createElement("option");t.text=e.level,t.setAttribute("value",e.level),n.options.add(t)}return l.appendChild(a),l.appendChild(o),l.appendChild(s),l.appendChild(i),l}/**
   * Creates the elective subject rows base on the requirement configuration.
   *
   * @param firstJupasCode
   */function f(e){x("elective_subject");let t=b(e),r=t.filter(e=>e[d.header.weights.category]===d.header.category.elective_subject&&!I().includes(e[d.header.weights.subject])),c=document.getElementById("calc-elective-subject-wrapper");if(r.length>0){let t=document.getElementById("calc-elective-subject"),l=r.sort((e,t)=>e["Subject Name"]>=t["Subject Name"]?1:-1);for(let r=1;r<=d.starting_row_count.elective_subject;r++)t.appendChild(h("elective_subject",e,l));c.classList.remove("hidden")}else c.classList.add("hidden")}/**
   * Creates the applied learning subject rows base on the requirement configuration.
   *
   * @param firstJupasCode
   */function j(e){x("applied_learning_subject");let t=b(e),r=t.filter(e=>e[d.header.weights.category]===d.header.category.applied_learning_subject&&!I().includes(e[d.header.weights.subject])),c=document.getElementById("calc-applied-learning-subject-wrapper");if(r.length>0){let t=document.getElementById("calc-applied-learning-subject"),l=r.sort((e,t)=>e["Subject Name"]>=t["Subject Name"]?1:-1);for(let r=1;r<=d.starting_row_count.applied_learning_subject;r++)t.appendChild(h("applied_learning_subject",e,l));c.classList.remove("hidden")}else c.classList.add("hidden")}/**
   * Creates the other language subject rows base on the requirement configuration.
   *
   * @param firstJupasCode
   */function v(e){x("other_language_subject");let t=b(e),r=t.filter(e=>e[d.header.weights.category]===d.header.category.other_language_subject&&!I().includes(e[d.header.weights.subject])),c=r.sort((e,t)=>e["Subject Name"]>=t["Subject Name"]?1:-1),l=document.getElementById("calc-other-language-subject-wrapper");if(r.length>0){let t=document.getElementById("calc-other-language-subject");for(let r=1;r<=d.starting_row_count.other_language_subject;r++)if(F(d.scores)){let e=t.appendChild(/**
   * Create a single subject row DOM element for elective subject, applied language subject
   * and other language subject.
   *
   * @param type
   * @param jupasCode
   * @param subjectList
   * @returns {HTMLDivElement}
   */function(e,t,r){let c=e.replaceAll("_","-"),l=document.createElement("div");l.classList.add("calc-row"),l.classList.add("calc-grid");let a=document.createElement("div");a.classList.add("calc-item");let o=document.createElement("div");o.classList.add("calc-item");let n=document.createElement("select");n.classList.add(c+"-level"),n.classList.add("calc-item-level"),n.setAttribute("name",c+"-level[]"),n.required=!0,o.appendChild(n);let s=document.createElement("div");s.classList.add("calc-item"),s.classList.add("calc-item-weight"),s.classList.add(c+"-weight");let i=document.createElement("div");i.classList.add("calc-item"),i.classList.add("calc-item-score"),i.classList.add(c+"-score"),i.innerText="0";let u=document.createElement("select");if(u.classList.add(c),u.classList.add("calc-item-subject"),u.setAttribute("name",c+"[]"),u.required=!0,r.length>0){// Populate options.
let e=document.createElement("option");for(let t of(e.text="Select a Subject",e.setAttribute("value",""),u.options.add(e),r)){let e=document.createElement("option");e.text=t[d.header.weights.subject],e.setAttribute("value",t[d.header.weights.subject]),u.options.add(e)}}a.appendChild(u);let m=document.createElement("option");return m.text="-",m.setAttribute("value",""),n.options.add(m),// const filteredLevels = filterMinimumLevelByType(config.scores[type], type);
// for (let item of filteredLevels) {
//   const levelOption = document.createElement("option");
//   levelOption.text = item.level;
//   levelOption.setAttribute("value", item.level);
//   levelSelect.options.add(levelOption);
// }
l.appendChild(a),l.appendChild(o),l.appendChild(s),l.appendChild(i),l}("other_language_subject",0,c));y(e)}else t.appendChild(h("other_language_subject",e,c));l.classList.remove("hidden")}else l.classList.add("hidden")}function y(e){let t=e.querySelector(".other-language-subject");t.addEventListener("change",function(e){let t=this.closest(".calc-row").querySelector(".other-language-subject-level");selected_language=e.target.value,// Remove levels and start afresh every time
function(e){for(;e.options.length>0;)e.remove(0)}(t);let r=document.createElement("option");if(r.text="-",r.setAttribute("value",""),t.options.add(r),""!=selected_language){let e=selected_language.replace(/ /g,"_").toLowerCase(),r=d.scores["other_language_subject_"+e];for(let e of r){let r=document.createElement("option");r.text=e.level,r.setAttribute("value",e.level),t.options.add(r)}}})}/**
   * Resets all score values back to default.
   */function S(){// Todo: fix for attained as it should no be set to 0 but blank.
let e=document.querySelectorAll(".core-subject-score, .calc-item-score");for(let t of e)t.innerHTML=0}/**
   * Add a subject row by cloning a row of the passed type.
   * @param type
   */function L(e){let t=e.replaceAll("_","-"),r=document.querySelector("#calc-"+t+" .calc-row"),c=r.cloneNode(!0);c.querySelector(".calc-item-weight").innerHTML="",c.querySelector(".calc-item-score").innerHTML="0",c.querySelector(".calc-item-score").classList.remove("selected-score"),// Ensure error class is removed
c.querySelector(".core-subject, .core-subject-level, .calc-item-subject, .calc-item-level").classList.remove("item-error");let l=document.getElementById("calc-"+t).appendChild(c);F(d.scores)&&"other_language_subject"===e&&y(l)}/**
   * Get the actually score value from the level name.
   *
   * @param scores
   * @param level
   * @returns {*|string}
   */function w(e,t){let r=e.find(e=>e.level===t);return void 0!==r?r.value:""}/**
   * Builds the score object for each subject row.
   *
   * @returns {*[]}
   */function q(){let e=[],r=document.querySelectorAll(".calc-row"),c=b(t.value);// Work out score for each row
for(let[t,l]of r.entries()){// Get parentElement to get subject category
let r=l.parentElement.id,a=r.replace(/^calc-/,""),o=r.replace(/^calc-/,"").replaceAll("-","_"),n=l.querySelector("."+a),s=l.querySelector(".core-subject-level, .calc-item-level"),i="core_subject"===o?n.innerText:n.value,u=s.value,m=0,b="other_language_subject_"+i.replace(/ /g,"_").toLowerCase();m=d.scores.hasOwnProperty(b)&&"other_language_subject"==o?w(d.scores[b],u):w(d.scores[o],u);let p=0,g=0;if(""!==i&&""!==u){if(M()&&i===H("core_subject_4"))p=0,g=0;else{let e=c.find(e=>e[d.header.weights.subject]===i);g=e[d.header.weights.weighting],p=parseFloat(m)*parseFloat(g)}}let _={subject:i,level:u,level_score:m,weight:g,score:p,category:o,row_index:t};e.push(_)}return e}/**
   * Removes the selected-score css class from all score elements.
   */function E(){let e=document.querySelectorAll(".core-subject-score, .calc-item-score");for(let t of e)t.classList.remove("selected-score"),t.classList.remove("bonus-score")}/**
   * Remove all subject row DOM elements by type.
   *
   * @param type
   */function x(e){let t=document.querySelectorAll("#calc-"+e.replaceAll("_","-")+" .calc-row");for(let e of t)e.remove()}/**
   * Remove all validation highlight css class item-error.
   */function T(){let e=document.querySelectorAll(".core-subject, .calc-item-subject, .core-subject-level, .calc-item-level");for(let t of e)t.classList.remove("item-error")}/**
   * Return the key of an object by its value.
   *
   * @param object
   * @param value
   * @returns {string}
   */function A(e,t){return Object.keys(e).find(r=>e[r]===t)}/**
   * Get the core subject names from the requirement config.
   *
   * @returns {*}
   */function I(){return d.requirements.map(e=>e.name)}/**
   * Get the level by its subject name from the requirement config.
   *
   * @param name
   * @returns {number|null|number|string|*}
   */function k(e){let t=d.requirements.find(t=>t.name===e);if(void 0===t)throw Error('Cannot find level for subject "'+e+'"');return t.level}/**
   * Get the core subject name by its key from the requirement config.
   *
   * @param key
   * @returns {*|string}
   */function H(e){let t=d.requirements.find(t=>t.key===e);if(void 0===t)throw Error('Cannot find core subject matching "'+e+'"');return t.name}/**
   * Determine if liberal studies is using Attained/Not Attained from the requirement config.
   *
   * @returns {boolean}
   */function M(){let e=d.requirements.find(e=>"core_subject_4"===e.key);return"Attained"===e.level}/**
   * Get programme by jupas code.
   */function B(e){return foundProgramme=d.data.ADMISSIONS.find(t=>t[d.header.programmes.jupas_code]===e)}/**
   * Filter the level to the minimum levels from configuration
   *
   * @param {*} levels
   * @param {*} type
   * @returns
   */function C(e,t){if(d.minimum_level.hasOwnProperty(t)){let r=e.findIndex(e=>e.level===d.minimum_level[t]);return e.slice(0,r+1)}return e}function F(e){let t=Object.keys(e);for(let e of t)if(e.startsWith("other_language_subject_"))return!0}return m.addEventListener("change",function(){m.options[m.selectedIndex].value;var e=document.getElementById("prog-name");setTimeout(()=>{e.scrollIntoView({behavior:"smooth"},!0)},1)}),/**
   * Event listener on facility select input. Will update programme select input to those
   * of the selected facility.
   */e.addEventListener("change",function(){let e;t.innerText="",e=""!==this.value?s[this.value]:n;let r=document.createElement("option");for(let[c,l]of(r.text="Select a Programme",r.setAttribute("value",""),t.options.add(r),e)){let e=document.createElement("option");e.text=l.toString(),e.setAttribute("value",c.toString()),t.options.add(e)}// Trigger programme select event.
let c=new Event("change");t.dispatchEvent(c)}),/**
   * Event listener for programme select input. Will update the programme details and weight base on the
   * selected programme.
   */t.addEventListener("change",function(){let e=b(this.value);p(),g(d.data.ADMISSIONS,this.value),_(e),f(this.value),j(this.value),v(this.value)}),/**
   * Event listener for the reset button. Resets the calculator but not the
   * selected facility and programme.
   */r.addEventListener("click",function(){p()}),/**
   * Event listener for the calculate button. Will call validation and if that passes calculate
   * the score based on the programme's calculate mechanism.
   *
   */c.addEventListener("click",function(){let e=/**
   * Validate user has completed calculator form correctly fulfilled the calculation mechanism requirements.
   *
   * @returns {*[]}
   */function(){let e;let r=[],c=document.querySelectorAll(".calc-row"),l=q(),a=l.filter(e=>""!==e.subject&&""!==e.level&&e.subject!==H("core_subject_4"));// Validate for all selected subject, the subject level are set.
for(let e of(// Clear previous validation highlight classes.
T(),// Clear score to 0.
S(),// Clear score highlights
E(),l))""!==e.subject&&""===e.level&&(r.push(d.errors.general_must_set_level.formatUnicorn({subject:e.subject})),c[e.row_index].querySelector(".core-subject-level, .calc-item-level").classList.add("item-error"));if(r.length>0)return r;// Validate liberal studies is attained.
for(let e of l)e.subject===H("core_subject_4")&&"attained"!==e.level&&(r.push(d.errors.general_requirement_liberal_studies_attained.formatUnicorn({subject:e.subject})),c[e.row_index].querySelector(".core-subject-level, .calc-item-level").classList.add("item-error"));// Validate duplicate subjects.
let o=/**
   * Check for duplicates in an array.
   *
   * @param arr
   * @returns {*}
   */function(e){let t=[],r=e.filter(e=>""!==e.subject&&(!!t.find(t=>t.subject===e.subject)||(t.push(e),!1)));return r}(l);if(o.length>0){for(let e of o)r.push(d.errors.general_duplicate.formatUnicorn({subject:e.subject,category:d.subject_category[e.category]})),c[e.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error");return r}// Validate similar subjects.
let n=d.validations;for(let e of n){let t=/**
   * Find intersections to determine if similar subjects exists.
   *
   * @param scores
   * @param similar
   * @returns {*}
   */function(e,t){return e.filter(e=>t.includes(e.subject))}(l,e);if(t.length>1){let e=t.map(e=>e.subject);for(let l of(r.push(d.errors.general_same_subject_group.formatUnicorn({subjects:e.slice(0,-1).join(", ")+" and "+e.slice(-1),category:d.subject_category[t[0].category]})),t))c[l.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error");return r}}// Validate calculate mechanism requirements.
let s=B(t.value),i=A(d.score_mechanism,s[d.header.programmes.calculation_mechanism]);if(void 0===i)throw Error("Cannot find mechanism"+s[d.header.programmes.calculation_mechanism]);switch(i){case"b5":if(e=5,a.length<e)// highlight first empty row
{for(let e of(r.push(d.errors.b5_must_5_subject),l))if(""===e.subject){c[e.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error");break}}break;case"b5_and_bonus1":if(e=5,a.length<e)// highlight first empty row
{for(let e of(r.push(d.errors.b5_must_5_subject),l))if(""===e.subject){c[e.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error");break}}break;case"core_and_b2":let u=a.filter(e=>"core_subject"===e.category),m=a.filter(e=>"core_subject"!==e.category);if(u.length<4||m.length<2)for(let e of(r.push(d.errors.core_and_b2_all_4_core_and_2_elective),l))c[e.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error");break;case"c_and_e_and_b3":if(// No need validate chinese and english as always set
e=5,a.length<e){for(let e of(r.push(d.errors.c_and_e_and_b3_must_english_and_chinese),l))if(""===e.subject){c[e.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error");break}}break;case"c_and_e_and_b3_and_bonus1":if(// No need validate chinese and english as always set
e=5,a.length<e){for(let e of(r.push(d.errors.c_and_e_and_b3_must_english_and_chinese),l))if(""===e.subject){c[e.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error");break}}break;case"b6":if(e=6,a.length<e){r.push(d.errors.b6_must_6_subject);let e=0;for(let t of l)""!==t.subject&&""!==t.level&&"core_subject"!==t.category&&(c[t.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error"),e++);for(let t of l)if(""===t.subject&&(c[t.row_index].querySelector(".core-subject, .calc-item-subject").classList.add("item-error"),e++),2==e)break}}return r.length>0?r:[]}();if(0===e.length){// Remove errors.
let e=document.getElementById("calculate-messages-wrapper");e.innerHTML="",e.classList.add("hidden");let r=B(t.value),c=A(d.score_mechanism,r[d.header.programmes.calculation_mechanism]);if(/**
   * Determine which mechanism's calcualte function to call bas on the mechanism key.
   *
   * @param mechanism
   */function(e){switch(e){case"b5":/**
   * Calculate the best 5 subjects and set total score.
   */(function(){E();let e=document.querySelectorAll(".calc-row"),t=q(),r=t.filter(e=>""!==e.subject&&""!==e.level),c=r.sort((e,t)=>t.score>=e.score?1:-1),l=c.slice(0,5),a=0;for(let t of l)e[t.row_index].querySelector(".core-subject-score, .calc-item-score").classList.add("selected-score"),a+=parseFloat(t.score);let o=document.getElementById("calc-total-score");o.innerHTML=a.toString()})();break;case"b5_and_bonus1":/**
   * Calculate the best 5 subjects and set total score.
   */(function(){E();let e=document.querySelectorAll(".calc-row"),t=q(),r=t.filter(e=>""!==e.subject&&""!==e.level),c=r.sort((e,t)=>t.score>=e.score?1:-1),l=c.slice(0,5),a=c.slice(5);if(a.length>0){let e=a.sort((e,t)=>{let r=parseFloat(t.level_score?t.level_score:"0"),c=parseFloat(e.level_score?e.level_score:"0"),l=r*parseFloat(e.weight),a=c*parseFloat(e.weight);return l==a?c<r?-1:c>r?1:0:a>=l}),t=e.find(e=>e.level_score>=3);t&&((bonusScore=JSON.parse(JSON.stringify(t))).bonus="B",bonusScore.score=parseFloat(bonusScore.level_score)*parseFloat(bonusScore.weight)*parseFloat(.1),l.push(bonusScore))}let o=0;for(let t of l)e[t.row_index].querySelector(".core-subject-score, .calc-item-score").classList.add("selected-score"),t.hasOwnProperty("bonus")&&e[t.row_index].querySelector(".core-subject-score, .calc-item-score").classList.add("bonus-score"),o+=parseFloat(t.score);let n=document.getElementById("calc-total-score");n.innerHTML=o.toString()})();break;case"core_and_b2":/**
   * Calculate the 4 core subject and best 2 elective subjects and set total score.
   * Per clients confirmation, 2 elective subjects include both Applied Learning Subjects and Other Language Subjects
   */(function(){E();let e=document.querySelectorAll(".calc-row"),t=q(),r=t.filter(e=>""!==e.subject&&""!==e.level),c=r.filter(e=>"core_subject"===e.category).sort((e,t)=>t.score>=e.score?1:-1).slice(0,4),l=r.filter(e=>"core_subject"!==e.category).sort((e,t)=>t.score>=e.score?1:-1).slice(0,2),a=c.concat(l),o=0;for(let t of a)e[t.row_index].querySelector(".core-subject-score, .calc-item-score").classList.add("selected-score"),o+=parseFloat(t.score);let n=document.getElementById("calc-total-score");n.innerHTML=o.toString()})();break;case"c_and_e_and_b3":/**
   * Calculate the Chinese Language and English Language and Any best 3 subjects and set total score.
   */(function(){E();let e=document.querySelectorAll(".calc-row"),t=q(),r=H("core_subject_1"),c=H("core_subject_2"),l=t.filter(e=>""!==e.subject&&""!==e.level),a=l.filter(e=>"core_subject"===e.category&&(e.subject===r||e.subject===c)),o=l.filter(e=>!(e.subject===r||e.subject===c)).sort((e,t)=>t.score>=e.score?1:-1).slice(0,3),n=0;for(let t of a.concat(o))e[t.row_index].querySelector(".core-subject-score, .calc-item-score").classList.add("selected-score"),n+=parseFloat(t.score);let s=document.getElementById("calc-total-score");s.innerHTML=n.toString()})();break;case"c_and_e_and_b3_and_bonus1":/**
   * Calculate the Chinese Language and English Language and Any best 3 subjects and set total score.
   */(function(){E();let e=document.querySelectorAll(".calc-row"),t=q(),r=H("core_subject_1"),c=H("core_subject_2"),l=t.filter(e=>""!==e.subject&&""!==e.level),a=l.filter(e=>"core_subject"===e.category&&(e.subject===r||e.subject===c)),o=l.filter(e=>!(e.subject===r||e.subject===c)).sort((e,t)=>t.score>=e.score?1:-1),n=o.slice(0,3),s=o.slice(3);if(s.length>0){let e=s.sort((e,t)=>{let r=parseFloat(t.level_score?t.level_score:"0"),c=parseFloat(e.level_score?e.level_score:"0"),l=r*parseFloat(e.weight),a=c*parseFloat(e.weight);return l==a?c<r?-1:c>r?1:0:a>=l}),t=e.find(e=>e.level_score>=3);bonusScore=null,t&&((bonusScore=JSON.parse(JSON.stringify(t))).bonus="B",bonusScore.score=parseFloat(bonusScore.level_score)*parseFloat(bonusScore.weight)*parseFloat(.1))}let i=a.concat(n);null!==bonusScore&&(i=i.concat(bonusScore));let u=0;for(let t of i)e[t.row_index].querySelector(".core-subject-score, .calc-item-score").classList.add("selected-score"),t.hasOwnProperty("bonus")&&e[t.row_index].querySelector(".core-subject-score, .calc-item-score").classList.add("bonus-score"),u+=parseFloat(t.score);let d=document.getElementById("calc-total-score");d.innerHTML=u.toString()})();break;case"b6":/**
   * Calculate the best 6 subject and set the total score.
   */(function(){E();let e=document.querySelectorAll(".calc-row"),t=q(),r=t.filter(e=>""!==e.subject&&""!==e.level),c=r.sort((e,t)=>t.score>=e.score?1:-1),l=c.slice(0,6),a=document.getElementById("calc-total-score"),o=0;for(let t of l)e[t.row_index].querySelector(".core-subject-score, .calc-item-score").classList.add("selected-score"),o+=parseFloat(t.score);a.innerHTML=o.toString()})()}}(c),/**
   * Fill in and display the weight and score after calculation.
   */function(){let e=document.querySelectorAll(".calc-row"),t=document.getElementById("prog-jupas-code"),r=t.innerText,c=b(r);for(let t of e){let e=t.parentElement.id,r=e.replace(/^calc-/,""),l=t.querySelector("."+r),a=t.querySelector("."+r+"-level"),o=t.querySelector("."+r+"-weight"),n=t.querySelector("."+r+"-score"),s=e.replace(/^calc-/,"").replaceAll("-","_"),i=l.innerText;// Skip for liberal studies
if(i!==H("core_subject_4")){// TODO check changeing targetType to subjectType
if(""!==l.value&&""!==a.value){let e=[];if(e="core_subject"===s?c.find(e=>e[d.header.weights.subject]===i):c.find(e=>e[d.header.weights.subject]===l.value&&e[d.header.weights.category]===d.header.category[s]),n.classList.contains("bonus-score")){// Override bonus value. //Enhance to add 3rd elective subject bonus.
let t=e[d.header.weights.weighting],r=0,c=l.value?"other_language_subject_"+l.value.replace(/ /g,"_").toLowerCase():"";r=Math.round(((r=d.scores.hasOwnProperty(c)&&"other_language_subject"===s?parseFloat(w(d.scores[c],a.value))*parseFloat(t)*parseFloat(.1):parseFloat(w(d.scores[s],a.value))*parseFloat(t)*parseFloat(.1))+Number.EPSILON)*100)/100,o.innerHTML=t.toString()+" (10%)",n.innerHTML=r.toString()}else{let t=e[d.header.weights.weighting],r=0,c=l.value?"other_language_subject_"+l.value.replace(/ /g,"_").toLowerCase():"";r=d.scores.hasOwnProperty(c)&&"other_language_subject"===s?parseFloat(w(d.scores[c],a.value))*parseFloat(t):parseFloat(w(d.scores[s],a.value))*parseFloat(t),o.innerHTML=t,n.innerHTML=r.toString()}}else o.innerHTML="",n.innerHTML="0"}}}(),foundProgramme){let e=document.getElementById("calc-intake");e.innerHTML=u.makeHtml(foundProgramme[d.header.programmes.intake_score]);let t=document.getElementById("calc-reference-score");void 0!==t&&null!=t&&d.header.programmes.reference_score&&(t.innerHTML=u.makeHtml(foundProgramme[d.header.programmes.reference_score]));let r=document.getElementById("calc-total-score-remark");void 0!==r&&null!=r&&d.header.programmes.score_remark&&(r.innerHTML=u.makeHtml(foundProgramme[d.header.programmes.score_remark]))}let l=document.getElementById("calculate-result-wrapper");document.querySelector("#calc-total-score-footnote").innerHTML=i.makeHtml(d.label.calc_total_score_footnote).formatUnicorn({jupas_code:t.value}),l.classList.remove("hidden")}else{let t=document.createElement("ul");for(let r of(t.classList.add("calc-error"),e)){let e=document.createElement("li");e.innerText=r.toString(),t.appendChild(e)}let r=document.getElementById("calculate-messages-wrapper");r.innerHTML="",r.appendChild(t),r.classList.remove("hidden");let c=document.getElementById("calculate-result-wrapper");c.classList.add("hidden")}}),/**
   * Event listener for the add subject button for elective subjects. Adds a new subject row.
   */l.addEventListener("click",function(){L("elective_subject")}),/**
   * Event listener for the add subject button for other language subjects. Adds a
   * new subject row.
   */a.addEventListener("click",function(){L("other_language_subject")}),String.prototype.formatUnicorn=String.prototype.formatUnicorn||function(){let e=this.toString();if(arguments.length){let t=typeof arguments[0],r="string"===t||"number"===t?Array.prototype.slice.call(arguments):arguments[0];for(let t in r)e=e.replace(RegExp("\\{"+t+"\\}","gi"),r[t])}return e},{init:/**
   * Initiate.
   *
   * @param options
   */function(r){d=Object.assign({},d,r),/**
   * Populate the calculator page.
   */function(){/**
   * Populates the facility and programme select input.
   */(function(){let r={};// Fill dropdown options.
for(let e of d.data.ADMISSIONS){let t=e[d.header.programmes.facility].trim(),c=e[d.header.programmes.programme].trim(),l=e[d.header.programmes.jupas_code];o.add(t),n.set(l,c),r.hasOwnProperty(t)||(r[t]=new Map),r[t].set(l,c)}// Sort the programme by school.
for(let e in r)s[e]=new Map([...r[e].entries()].sort((e,t)=>e[1]-t[1]));// Sort the programme list.
let c=[...o].sort(),l=new Map([...n.entries()].sort((e,t)=>e[1]-t[1])),a=document.createElement("option");// Build facility select options.
for(let t of(a.text=d.label.facility_select,a.setAttribute("value",""),e.options.add(a),c)){let r=document.createElement("option");r.text=t,r.setAttribute("value",t),e.options.add(r)}// Add blank option
let i=document.createElement("option");// Build programme select options.
for(let[e,r]of(i.text=d.label.programme_select,i.setAttribute("value",""),t.options.add(i),l.entries())){let c=document.createElement("option");c.text=r,c.setAttribute("value",e),t.options.add(c)}})(),/**
   * Preset the discipline and programme select input if the url has querystring
   * parameters discipline and/or jupas_code.
   */function(){let r=new URLSearchParams(window.location.search);if(r.has("discipline")){let t=r.get("discipline");if([...e.options].map(e=>e.value).includes(t)){e.value=t;let r=new Event("change");e.dispatchEvent(r)}}if(r.has("jupas_code")){let e=r.get("jupas_code");if([...t.options].map(e=>e.value).includes(e)){t.value=e;let r=new Event("change");t.dispatchEvent(r)}}}(),/**
   * Populate all the labels on the display.
   */function(){document.querySelector(".jupas-calculator-faculty-select-title").innerHTML=i.makeHtml(d.label.jupas_calculator_faculty_select_title),document.querySelector(".general-entrance-requirements-title").innerText=d.label.general_entrance_requirements_title,document.querySelector(".admission-remarks").innerHTML=i.makeHtml(d.admission.remarks),document.querySelector(".button-admission-figure > a").innerText=d.label.admission_figure_button,document.querySelector(".button-admission-figure > a").setAttribute("href",d.label.admission_figure_button_url),document.querySelector("#prog-detail-wrapper > .prog-jupas-code > .prog-item-name").innerText=d.label.programme_code,document.querySelector("#prog-detail-wrapper > .prog-quota > .prog-item-name").innerText=d.label.programme_quota,document.querySelector("#prog-detail-wrapper > .prog-calc-mechanism > .prog-item-name").innerText=d.label.programme_calculation_mechanism,document.querySelector("#prog-preferred-subject-wrapper div:nth-child(1)").innerText=d.label.programme_preferred_subjects,document.querySelector("#prog-relavent-subject-wrapper div:nth-child(1)").innerText=d.label.programme_relevant_subjects,document.querySelector("#prog-remarks-wrapper div:nth-child(1)").innerText=d.label.programme_remarks,document.querySelector("#input-your-subject-level-title").innerText=d.label.input_your_subject_level_title,document.querySelector("#calc-core-subject .calc-header div:nth-child(1)").innerText=d.label.core_subject,document.querySelector("#calc-core-subject .calc-header div:nth-child(2)").innerText=d.label.core_subject_level,document.querySelector("#calc-core-subject .calc-header div:nth-child(3)").innerText=d.label.core_subject_weight,document.querySelector("#calc-core-subject .calc-header div:nth-child(4)").innerText=d.label.core_subject_score,document.querySelector("#calc-elective-subject .calc-header div:nth-child(1)").innerText=d.label.elective_subject,document.querySelector("#calc-elective-subject .calc-header div:nth-child(2)").innerText=d.label.elective_subject_level,document.querySelector("#calc-elective-subject .calc-header div:nth-child(3)").innerText=d.label.elective_subject_weight,document.querySelector("#calc-elective-subject .calc-header div:nth-child(4)").innerText=d.label.elective_subject_score,document.querySelector("#add-elective-subject-button").value=d.label.elective_subject_add_button,document.querySelector("#calc-applied-learning-subject .calc-header div:nth-child(1)").innerText=d.label.applied_learning_subject,document.querySelector("#calc-applied-learning-subject .calc-header div:nth-child(2)").innerText=d.label.applied_learning_subject_level,document.querySelector("#calc-applied-learning-subject .calc-header div:nth-child(3)").innerText=d.label.applied_learning_subject_weight,document.querySelector("#calc-applied-learning-subject .calc-header div:nth-child(4)").innerText=d.label.applied_learning_subject_score,document.querySelector("#applied-learning-subject-remark").innerText=d.label.applied_learning_subject_remark,document.querySelector("#calc-other-language-subject .calc-header div:nth-child(1)").innerText=d.label.other_language_subject,document.querySelector("#calc-other-language-subject .calc-header div:nth-child(2)").innerText=d.label.other_language_subject_level,document.querySelector("#calc-other-language-subject .calc-header div:nth-child(3)").innerText=d.label.other_language_subject_weight,document.querySelector("#calc-other-language-subject .calc-header div:nth-child(4)").innerText=d.label.other_language_subject_score,document.querySelector("#add-other-language-button").value=d.label.other_language_subject_add_button,document.querySelector("#jupas-reset-button").value=d.label.reset_button,document.querySelector("#jupas-calculate-button").value=d.label.calculate_button,document.querySelector("#calc-total-score-title").innerText=d.label.total_score;// Add quota info
let e=document.createElement("i");e.classList.add("fa-solid","fa-circle-info");let t=document.createElement("span");t.setAttribute("data-tooltip",d.label.programme_quota_info),t.appendChild(e),document.querySelector("#prog-detail-wrapper > .prog-quota > .prog-item-name").appendChild(t)}();let r=b(t.value);/**
   * Populate the general entry requirements display.
   */(function(){let e=document.getElementById("requirement-wrapper"),t=document.getElementById("req-core-subject-title"),r=document.getElementById("req-elective-subject-title");t.innerHTML=i.makeHtml(d.label.core_subject_title),r.innerHTML=i.makeHtml(d.label.elective_subject_title);let c=d.requirements;for(let t of c){let r=document.createElement("div");r.classList.add("req-item"),r.classList.add("req-item-name"),r.innerHTML=t.name,e.appendChild(r)}for(let t of c){let r=document.createElement("div");r.classList.add("req-item"),r.classList.add("req-item-value"),r.innerHTML=t.level,e.appendChild(r)}})(),g(d.data.ADMISSIONS,t.value),_(r),f(t.value),j(t.value),v(t.value)}()}}})().init(drupalSettings.jupas_calculator);//console.log(drupalSettings.jupas_calculator);
})}}})();//# sourceMappingURL=jupas_calculator.js.map

//# sourceMappingURL=jupas_calculator.js.map
