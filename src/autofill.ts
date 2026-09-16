/**
 * Contact fields pulled from a base resume's header, for the per-application
 * autofill bookmarklet (fills name/email/phone/links into external forms).
 */
import fs from "node:fs";
import { DEFAULT_KEY, mdFile, stripLabel } from "./profile.ts";
import { candidateName } from "./filenames.ts";

export interface ContactInfo {
  name: string; first: string; last: string;
  email: string; phone: string;
  linkedin: string; github: string; website: string;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(\+?\d[\d ()-]{7,}\d)/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+\/?[^\s|]*/gi;

/** Parses the first few header lines of a resume (name + contact line) for form-fillable fields. */
export function contactInfo(md: string, name: string): ContactInfo {
  const head = stripLabel(md).split("\n").slice(0, 6).join(" ");
  const email = EMAIL_RE.exec(head)?.[0] ?? "";
  const rest = email ? head.replace(email, " ") : head;
  const phone = PHONE_RE.exec(rest)?.[0]?.trim() ?? "";
  const urls = [...rest.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;)]+$/, ""));
  const linkedin = urls.find((u) => /linkedin\.com/i.test(u)) ?? "";
  const github = urls.find((u) => /github\.com/i.test(u)) ?? "";
  const website = urls.find((u) => u !== linkedin && u !== github) ?? "";
  const [first, ...last] = name.split(" ");
  return { name, first: first ?? "", last: last.join(" "), email, phone, linkedin, github, website };
}

/** Contact info for a base resume (default if the key is unknown or has no imported markdown). */
export function candidateContact(resumeKey?: string | null): ContactInfo {
  const name = candidateName(resumeKey);
  let file = mdFile(resumeKey || DEFAULT_KEY);
  if (!fs.existsSync(file)) file = mdFile(DEFAULT_KEY);
  if (!fs.existsSync(file)) return { name, first: "", last: "", email: "", phone: "", linkedin: "", github: "", website: "" };
  return contactInfo(fs.readFileSync(file, "utf8"), name);
}

/** The bookmarklet: fetches this application's contact info + Q&A, matches them to visible form
 * fields by label text, and fills what it can — never anything the applicant hasn't already said. */
export function autofillBookmarklet(origin: string, appId: number): string {
  const src = `
(function(){
  var ORIGIN=${JSON.stringify(origin)}, APP=${appId};
  function toast(msg){
    var d=document.createElement('div');
    d.textContent=msg;
    d.style.cssText='position:fixed;bottom:20px;right:20px;background:#111;color:#fff;padding:10px 16px;border-radius:8px;font:14px system-ui,sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.35)';
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 6000);
  }
  function labelFor(el){
    var t='';
    if(el.id){ var l=document.querySelector('label[for="'+CSS.escape(el.id)+'"]'); if(l) t+=' '+l.innerText; }
    var wrap=el.closest('label'); if(wrap) t+=' '+wrap.innerText;
    t+=' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')+' '+(el.name||'')+' '+(el.id||'');
    if(!t.trim()){
      var prev=el.closest('div,li,fieldset');
      var heading=prev&&prev.querySelector('label,legend,h1,h2,h3,h4,strong');
      if(heading) t+=' '+heading.innerText;
    }
    return t.toLowerCase().replace(/\\s+/g,' ').trim();
  }
  function setValue(el, val){
    var proto = el.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype : el.tagName==='SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto,'value');
    setter = setter && setter.set;
    if(el.tagName==='SELECT'){
      var opt=Array.prototype.find.call(el.options, function(o){ return o.text.toLowerCase().indexOf(String(val).toLowerCase())>-1 || o.value.toLowerCase()===String(val).toLowerCase(); });
      if(!opt) return false;
      val=opt.value;
    }
    if(setter) setter.call(el,val); else el.value=val;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }
  var CONTACT_RULES=[
    [/first.?name|given.?name/, function(c){ return c.first; }],
    [/last.?name|family.?name|sur.?name/, function(c){ return c.last; }],
    [/full.?name|your name|applicant name|^name$/, function(c){ return c.name; }],
    [/e-?mail/, function(c){ return c.email; }],
    [/phone|mobile|cell/, function(c){ return c.phone; }],
    [/linkedin/, function(c){ return c.linkedin; }],
    [/github/, function(c){ return c.github; }],
    [/portfolio|personal (site|website)|website/, function(c){ return c.website; }]
  ];
  function bestQuestionMatch(label, questions){
    var words=label.split(/\\W+/).filter(function(w){ return w.length>3; });
    if(!words.length) return null;
    var wordSet={}; words.forEach(function(w){ wordSet[w]=1; });
    var best=null, bestScore=0;
    questions.forEach(function(q){
      var qwords=q.question.toLowerCase().split(/\\W+/).filter(function(w){ return w.length>3; });
      if(!qwords.length) return;
      var hits=qwords.filter(function(w){ return wordSet[w]; }).length;
      var score=hits/qwords.length;
      if(score>bestScore){ bestScore=score; best=q; }
    });
    return bestScore>=0.5 ? best.answer : null;
  }
  function fill(data){
    var contact=data.contact, questions=data.questions||[];
    var fields=Array.prototype.slice.call(document.querySelectorAll('input,textarea,select')).filter(function(el){
      if(el.disabled||el.readOnly) return false;
      var type=(el.type||'').toLowerCase();
      if(['hidden','submit','button','file','checkbox','radio','password'].indexOf(type)>-1) return false;
      if(el.value && String(el.value).trim()) return false;
      return el.offsetParent!==null;
    });
    var filled=0;
    fields.forEach(function(el){
      var label=labelFor(el);
      if(!label) return;
      var val=null;
      for(var i=0;i<CONTACT_RULES.length;i++){
        if(CONTACT_RULES[i][0].test(label)){ val=CONTACT_RULES[i][1](contact); break; }
      }
      if(!val && (el.tagName==='TEXTAREA' || el.tagName==='SELECT' || (el.tagName==='INPUT' && (el.type||'text').toLowerCase()==='text'))){
        val=bestQuestionMatch(label, questions);
      }
      if(val && setValue(el, val)){
        el.style.outline='2px solid #6366f1';
        filled++;
      }
    });
    var left=fields.length-filled;
    toast('Job Tracker: filled '+filled+' field'+(filled===1?'':'s')+(left?', '+left+' left for you':'')+'.');
  }
  fetch(ORIGIN+'/api/applications/'+APP+'/autofill', {mode:'cors'})
    .then(function(r){ if(!r.ok) throw new Error(); return r.json(); })
    .then(fill)
    .catch(function(){ alert('Could not reach Job Tracker at '+ORIGIN+' — make sure the app is running.'); });
})();`;
  return src.replace(/\n\s*/g, "\n").trim();
}
