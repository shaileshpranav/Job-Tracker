/**
 * Autofill bookmarklet: runs on a company's application form, fetches this
 * application's contact info, documents and answers from the tracker, and
 * fills what it can — never anything the applicant hasn't already said, and
 * never the submit button.
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

/** Hosts shared by many employers, where the first path segment names the company. */
const MULTI_TENANT = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|jobvite\.com|breezy\.hr|applytojob\.com|recruitee\.com|teamtailor\.com)$/i;
/** Aggregators: the same host for every company, so the host alone identifies nothing. */
const GENERIC_HOST = /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|xing\.com|stepstone\.de|monster\.com|ziprecruiter\.com|wellfound\.com|welcometothejungle\.com|google\.com)$/i;

/** "host" or "host/company" — good enough to tell which employer's form this is, so a posting on one
 * page and its application form on another can still be linked. Null for aggregators. */
export function siteKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (GENERIC_HOST.test(host)) return null;
    if (MULTI_TENANT.test(host)) {
      const first = u.pathname.split("/").filter(Boolean)[0];
      return first ? `${host}/${first.toLowerCase()}` : host;
    }
    return host;
  } catch { return null; }
}

/**
 * The bookmarklet. `appId` pins it to one application; without it, the tracker picks the
 * application from the page URL (or the user does, from a short list). `token` lets it
 * authenticate cross-origin when a password is set.
 */
export function autofillBookmarklet(origin: string, token: string, appId: number | null = null): string {
  const src = `
(function(){
  var ORIGIN=${JSON.stringify(origin)}, APP=${appId ?? "null"}, TOKEN=${JSON.stringify(token)};
  var ACCENT='#6366f1', PAGE=location.href;
  var STOP={your:1,please:1,what:1,with:1,this:1,that:1,have:1,about:1,would:1,from:1,which:1,does:1,will:1,tell:1,describe:1,when:1,were:1,their:1,there:1,than:1,then:1,them:1,they:1,into:1,much:1,many:1,some:1,such:1,also:1,been:1,being:1,could:1,should:1,most:1,more:1,very:1,here:1,know:1,like:1,want:1,work:1,working:1,role:1,position:1,company:1,question:1,answer:1,field:1,required:1,optional:1};
  var panel;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function txt(el){ return el?String(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim():''; }
  function norm(s){ return String(s||'').toLowerCase().replace(/[*:]+$/,'').replace(/\\s+/g,' ').trim(); }
  function words(s){ return norm(s).split(/[^a-z0-9+#]+/).filter(function(w){ return w.length>3&&!STOP[w]; }); }
  function ui(html){
    if(!panel){
      panel=document.createElement('div'); panel.id='jt-autofill';
      panel.style.cssText='position:fixed;bottom:20px;right:20px;width:min(380px,calc(100vw - 40px));max-height:70vh;overflow:auto;background:#141416;color:#f4f4f5;padding:14px 16px;border-radius:12px;font:13px/1.45 system-ui,sans-serif;z-index:2147483647;box-shadow:0 8px 32px rgba(0,0,0,.45);box-sizing:border-box';
      document.body.appendChild(panel);
    }
    panel.innerHTML='<style>#jt-autofill b{font-weight:600}#jt-autofill button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:6px 10px;margin:8px 6px 0 0;background:#27272a;color:#f4f4f5}#jt-autofill button.p{background:'+ACCENT+';color:#fff}#jt-autofill ul{margin:6px 0 0;padding-left:18px}#jt-autofill li{margin:2px 0}#jt-autofill .m{color:#a1a1aa}#jt-autofill a{color:#a5b4fc}#jt-autofill .x{position:absolute;top:8px;right:10px;background:none;margin:0;padding:2px 6px;font-size:16px}</style><button class="x" data-x>×</button>'+html;
    panel.querySelector('[data-x]').onclick=function(){ panel.remove(); panel=null; };
    return panel;
  }
  function api(path,opts){
    opts=opts||{}; opts.mode='cors'; opts.headers=Object.assign({'x-jt-token':TOKEN},opts.headers||{});
    return fetch(ORIGIN+path,opts).then(function(r){
      if(r.status===401) throw new Error('Job Tracker wants a login — open it, log in, then drag a fresh Fill bookmarklet from its home screen.');
      if(!r.ok) return r.json().then(function(j){ throw new Error(j.error||('HTTP '+r.status)); },function(){ throw new Error('HTTP '+r.status); });
      return r;
    });
  }
  function labelFor(el){
    var parts=[];
    if(el.id){ try{ document.querySelectorAll('label[for="'+CSS.escape(el.id)+'"]').forEach(function(l){ parts.push(txt(l)); }); }catch(e){} }
    var wrap=el.closest('label'); if(wrap) parts.push(txt(wrap));
    var lb=el.getAttribute('aria-labelledby'); if(lb) lb.split(/\\s+/).forEach(function(id){ var n=document.getElementById(id); if(n) parts.push(txt(n)); });
    parts.push(el.getAttribute('aria-label')||'',el.placeholder||'');
    var s=parts.join(' ').replace(/\\s+/g,' ').trim();
    if(s.replace(/[^a-z]/gi,'').length<3) s=containerLabel(el);
    if(s.replace(/[^a-z]/gi,'').length<3) s=[el.name||'',el.id||'',el.getAttribute('data-automation-id')||''].join(' ').replace(/[-_.\\[\\]]+/g,' ').trim();
    return s.replace(/\\s+/g,' ').trim();
  }
  function containerLabel(el){
    var n=el, i=0;
    while(n&&n!==document.body&&i++<6){
      n=n.parentElement; if(!n) break;
      var fields=n.querySelectorAll('input:not([type=hidden]),textarea,select');
      if(fields.length>1&&!(fields.length===2&&n.contains(el)&&fields[0].type===fields[1].type&&/file/.test(fields[0].type))) return '';
      var hs=n.querySelectorAll('legend,label,h1,h2,h3,h4,h5,h6,strong,b,[class*=label],[class*=Label],[class*=question],[class*=Question],[class*=title],[class*=Title]');
      for(var k=0;k<hs.length;k++){ if(hs[k].contains(el)) continue; var t=txt(hs[k]); if(t&&t.length<220) return t; }
      var prev=n.previousElementSibling; if(prev&&!prev.querySelector('input,textarea,select')){ var pt=txt(prev); if(pt&&pt.length<220) return pt; }
    }
    return '';
  }
  function groupLabel(radios){
    var c=radios[0].closest('fieldset,[role=group],[role=radiogroup]');
    if(!c){ c=radios[0].parentElement; while(c&&c!==document.body&&!radios.every(function(r){ return c.contains(r); })) c=c.parentElement; }
    if(!c) return '';
    var parts=[];
    var lg=c.querySelector('legend'); if(lg) parts.push(txt(lg));
    parts.push(c.getAttribute('aria-label')||'');
    var lb=c.getAttribute('aria-labelledby'); if(lb) lb.split(/\\s+/).forEach(function(id){ var n=document.getElementById(id); if(n) parts.push(txt(n)); });
    var s=parts.join(' ').trim();
    if(!s){
      var hs=c.querySelectorAll('label,h1,h2,h3,h4,h5,h6,strong,b,[class*=label],[class*=Label],[class*=question],[class*=Question],[class*=title],[class*=Title]');
      for(var k=0;k<hs.length;k++){ if(radios.some(function(r){ return hs[k].contains(r)||(r.id&&hs[k].getAttribute('for')===r.id); })) continue; var t=txt(hs[k]); if(t&&t.length<220){ s=t; break; } }
    }
    if(!s){ var prev=c.previousElementSibling; if(prev&&!prev.querySelector('input,textarea,select')) s=txt(prev); }
    return s.replace(/\\s+/g,' ').trim();
  }
  function optionLabel(r){
    var t='';
    if(r.id){ try{ var l=document.querySelector('label[for="'+CSS.escape(r.id)+'"]'); if(l) t=txt(l); }catch(e){} }
    if(!t){ var w=r.closest('label'); if(w) t=txt(w); }
    if(!t) t=r.getAttribute('aria-label')||'';
    if(!t){ var nx=r.nextElementSibling; if(nx) t=txt(nx); }
    return (t||r.value||'').trim();
  }
  function setValue(el,val){
    var proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;
    var d=Object.getOwnPropertyDescriptor(proto,'value'); var setter=d&&d.set;
    if(el.tagName==='SELECT'){
      var opts=[].slice.call(el.options).filter(function(o){ return o.value&&!/^(select|choose|please|--|—)/i.test(o.text.trim()); }).map(function(o){ return {el:o,label:o.text}; });
      var pick=pickOption(val,opts); if(!pick) return false;
      val=pick.el.value;
    }
    el.focus&&el.focus();
    if(setter) setter.call(el,val); else el.value=val;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true}));
    return true;
  }
  function pickOption(answer,opts){
    var a=norm(answer); if(!a||!opts.length) return null;
    var ex=opts.filter(function(o){ return norm(o.label)===a; }); if(ex.length===1) return ex[0];
    var yn=/^(yes|no)\\b/.exec(a);
    if(yn){ var m=opts.filter(function(o){ return new RegExp('^'+yn[1]+'\\\\b').test(norm(o.label)); }); if(m.length===1) return m[0]; }
    var inA=opts.filter(function(o){ var l=norm(o.label); return l.length>2&&a.indexOf(l)>-1; }); if(inA.length===1) return inA[0];
    var inL=opts.filter(function(o){ return a.length>2&&norm(o.label).indexOf(a)>-1; }); if(inL.length===1) return inL[0];
    return null;
  }
  var CONTACT_RULES=[
    [/first.?name|given.?name|vorname|pr[eé]nom/i,function(c){ return c.first; }],
    [/last.?name|family.?name|sur.?name|nachname|nom de famille/i,function(c){ return c.last; }],
    [/full.?name|your name|applicant name|legal name|^name\\b|\\bname$/i,function(c){ return c.name; }],
    [/e-?mail/i,function(c){ return c.email; }],
    [/phone|mobile|cell|telefon|téléphone/i,function(c){ return c.phone; }],
    [/linkedin/i,function(c){ return c.linkedin; }],
    [/github/i,function(c){ return c.github; }],
    [/portfolio|personal (site|website|url)|\\bwebsite\\b|homepage/i,function(c){ return c.website; }]
  ];
  function match(label,list,floor){
    var lw=words(label); if(!lw.length) return null;
    var nl=norm(label), set={}; lw.forEach(function(w){ set[w]=1; });
    var best=null, bestScore=0;
    list.forEach(function(q){
      var nq=norm(q.question);
      var score;
      if(nq===nl) score=2;
      else { var qw=words(nq); if(!qw.length) return; var hits=qw.filter(function(w){ return set[w]; }).length; score=hits/qw.length; if(qw.length>=3&&hits/lw.length<0.3) score=0; }
      if(score>bestScore){ bestScore=score; best=q; }
    });
    return bestScore>=floor?best:null;
  }
  function mark(el){ if(el&&el.style){ el.style.outline='2px solid '+ACCENT; el.style.outlineOffset='1px'; } }
  function questionLike(label,el){
    if(/search|password|captcha|verification|one.time|\\botp\\b|promo|coupon|city|country|state|province|postal|zip|address|salary|date|birth|gender|pronoun|ethnic|race|veteran|disabilit/i.test(label)) return false;
    if(el&&el.tagName==='TEXTAREA') return label.length>8;
    return /\\?/.test(label)||label.split(' ').length>=5;
  }
  function attachFile(el,docs,report){
    var label=labelFor(el).toLowerCase();
    var kind=/cover/.test(label)?'cover_letter':/resume|\\bcv\\b|curriculum/.test(label)?'resume':null;
    var d=kind&&docs[kind]; if(!d||(el.files&&el.files.length)) return Promise.resolve();
    var nice=kind==='resume'?'Resume':'Cover letter';
    return api('/api/autofill/doc/'+d.id+'.pdf').then(function(r){ return r.blob(); }).then(function(blob){
      var dt=new DataTransfer(); dt.items.add(new File([blob],d.file_name,{type:'application/pdf'}));
      el.files=dt.files;
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
      report.filled.push(nice+' — '+d.file_name); mark(el.closest('label')||el.parentElement);
    }).catch(function(){ report.left.push({label:nice+' upload — attach '+d.file_name+' from the application folder',noDraft:true}); });
  }
  function fill(data){
    var contact=data.contact||{}, qs=data.questions||[], bank=data.bank||[], docs=data.documents||{};
    var report={filled:[],left:[]}, tasks=[], radios={};
    [].slice.call(document.querySelectorAll('input,textarea,select')).forEach(function(el){
      if(el.disabled||el.readOnly||el.closest('#jt-autofill')) return;
      var type=(el.type||'text').toLowerCase();
      if(['hidden','submit','button','reset','image','password','checkbox','color','range','date','datetime-local','month','week','time','number'].indexOf(type)>-1) return;
      if(type==='radio'){ if(el.name) (radios[el.name]=radios[el.name]||[]).push(el); return; }
      if(type==='file'){ tasks.push(attachFile(el,docs,report)); return; }
      if(el.offsetParent===null) return;
      var label=labelFor(el); if(!label) return;
      if(el.value&&String(el.value).trim()) return;
      var val=null;
      for(var i=0;i<CONTACT_RULES.length;i++){ if(CONTACT_RULES[i][0].test(label)){ val=CONTACT_RULES[i][1](contact)||null; break; } }
      if(!val&&el.tagName==='TEXTAREA'&&/cover.?letter|anschreiben|lettre de motivation/i.test(label)&&data.cover_letter) val=data.cover_letter;
      if(!val){ var q=match(label,qs,0.5)||match(label,bank,0.75); if(q) val=q.answer; }
      if(val&&el.tagName==='INPUT'&&val.length>300) val=null;
      if(val&&setValue(el,val)){ mark(el); report.filled.push(label); return; }
      if(questionLike(label,el)){
        var item={label:label};
        if(el.tagName==='SELECT'){ var os=[].slice.call(el.options).map(function(o){ return o.text.trim(); }).filter(function(t){ return t&&!/^(select|choose|please|--|—)/i.test(t); }); if(os.length&&os.length<=10) item.options=os; }
        report.left.push(item);
      }
    });
    Object.keys(radios).forEach(function(name){
      var group=radios[name]; if(group.some(function(r){ return r.checked; })) return;
      var gl=groupLabel(group); if(!gl) return;
      var opts=group.map(function(r){ return {el:r,label:optionLabel(r)}; });
      var q=match(gl,qs,0.5)||match(gl,bank,0.75);
      var pick=q&&pickOption(q.answer,opts);
      if(pick){ pick.el.click(); if(!pick.el.checked){ pick.el.checked=true; pick.el.dispatchEvent(new Event('change',{bubbles:true})); } mark(pick.el.closest('label')||pick.el.parentElement); report.filled.push(gl); }
      else if(questionLike(gl)) report.left.push({label:gl,options:opts.map(function(o){ return o.label; }).filter(Boolean)});
    });
    Promise.all(tasks).then(function(){ showReport(data,report); });
  }
  function showReport(data,report){
    var app=data.application, drafts=report.left.filter(function(l){ return !l.noDraft; });
    var html='<div><b>Job Tracker</b> <span class="m">· '+esc(app.company)+' — '+esc(app.role)+'</span></div>';
    html+='<div style="margin-top:6px">'+(report.filled.length?'Filled <b>'+report.filled.length+'</b> field'+(report.filled.length===1?'':'s')+' (highlighted).':'Nothing matched on this page.')+' <span class="m">Nothing is submitted — check everything before you send.</span></div>';
    if(report.left.length){
      html+='<div style="margin-top:8px"><b>'+report.left.length+'</b> left for you:</div><ul>'+report.left.slice(0,8).map(function(l){ return '<li>'+esc(l.label.length>90?l.label.slice(0,88)+'…':l.label)+'</li>'; }).join('')+(report.left.length>8?'<li class="m">…and '+(report.left.length-8)+' more</li>':'')+'</ul>';
    }
    html+='<div>'+(drafts.length?'<button class="p" data-draft>Draft '+drafts.length+' answer'+(drafts.length===1?'':'s')+' in Job Tracker</button>':'')+'<button data-open>Open application</button></div>';
    var p=ui(html);
    p.querySelector('[data-open]').onclick=function(){ window.open(ORIGIN+'/?app='+app.id,'jobtracker'); };
    var b=p.querySelector('[data-draft]');
    if(b) b.onclick=function(){
      b.disabled=true; b.textContent='Sending…';
      var questions=drafts.map(function(l){ return l.options?l.label+' ('+l.options.join(' / ')+')':l.label; });
      api('/api/autofill/questions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app:app.id,questions:questions,url:PAGE})})
        .then(function(r){ return r.json(); })
        .then(function(j){ ui('<div><b>Job Tracker</b> <span class="m">· '+esc(app.company)+'</span></div><div style="margin-top:6px">Drafting <b>'+j.queued+'</b> answer'+(j.queued===1?'':'s')+' from your resume and earlier applications'+(j.skipped?' <span class="m">('+j.skipped+' already there)</span>':'')+'.</div><div class="m" style="margin-top:6px">Review them on the Questions tab, then click <b>Fill</b> here again to put them in.</div><div><button data-open>Open application</button></div>').querySelector('[data-open]').onclick=function(){ window.open(ORIGIN+'/?app='+app.id,'jobtracker'); }; })
        .catch(function(e){ b.disabled=false; b.textContent='Draft answers'; var d=document.createElement('div'); d.className='m'; d.style.marginTop='6px'; d.textContent=e.message; p.appendChild(d); });
    };
  }
  function choose(data){
    var html='<div><b>Job Tracker</b> <span class="m">· which application is this form for?</span></div>';
    if(!data.candidates.length) html+='<div class="m" style="margin-top:6px">No applications yet — capture the posting first.</div>';
    html+='<div style="margin-top:4px">'+data.candidates.map(function(c){ return '<button data-pick="'+c.id+'" style="display:block;width:100%;text-align:left">'+esc(c.company)+' <span class="m">— '+esc(c.role)+' · '+esc(c.status)+'</span></button>'; }).join('')+'</div>';
    html+='<div class="m" style="margin-top:8px">Tip: the Fill link inside an application\\'s apply pack is pinned to that application.</div>';
    var p=ui(html);
    p.querySelectorAll('[data-pick]').forEach(function(b){ b.onclick=function(){ start(Number(b.getAttribute('data-pick'))); }; });
  }
  function start(app){
    ui('<div><b>Job Tracker</b> <span class="m">· looking up this application…</span></div>');
    api('/api/autofill?url='+encodeURIComponent(PAGE)+(app?'&app='+app:''))
      .then(function(r){ return r.json(); })
      .then(function(d){ if(d.candidates) choose(d); else fill(d); })
      .catch(function(e){ ui('<div><b>Job Tracker</b></div><div style="margin-top:6px">'+esc(e.message&&e.message!=='Failed to fetch'?e.message:'Could not reach Job Tracker at '+ORIGIN+' — make sure it is running. On an https page the tracker must be opened via http://localhost, not an IP address.')+'</div>'); });
  }
  start(APP);
})();`;
  return src.replace(/\n\s*/g, "\n").trim();
}
