import { useState, useEffect, useCallback } from "react";

const ADMIN_EMAIL = "admin@afishi.ru";
const ADMIN_PASS  = "Afishi2018!";

const COLORS = {
  red:   "#c8102e",
  dark:  "#1a1a1a",
  gold:  "#c9a84c",
  bg:    "#f4f2ee",
  border:"#e0e0e0",
};

const SEED_EVENTS = [
  {id:"e1",  title:"Lida — сольный концерт",      date:"19 авг 2026", venue:"Кроп Арена",         city:"Волгоград", cat:"concert", status:"approved",  price:"от 2500 ₽", icon:"🎤"},
  {id:"e2",  title:"Ирина Аллегрова",              date:"12 сен 2026", venue:"ЦКЗ Филармония",      city:"Волгоград", cat:"concert", status:"approved",  price:"от 3000 ₽", icon:"🎵"},
  {id:"e3",  title:"Золушка",                      date:"7 июн 2026",  venue:"ТЮЗ",                city:"Волгоград", cat:"theater", status:"approved",  price:"от 400 ₽",  icon:"🎭"},
  {id:"e4",  title:"Ромео и Джульетта",            date:"15 июн 2026", venue:"Театр НЭТ",           city:"Волгоград", cat:"theater", status:"approved",  price:"от 600 ₽",  icon:"🎭"},
  {id:"e5",  title:"Лебединое озеро",              date:"20 июн 2026", venue:"Царицынская Опера",   city:"Волгоград", cat:"theater", status:"approved",  price:"от 800 ₽",  icon:"🎶"},
  {id:"e6",  title:"Новый рок-фестиваль",          date:"5 июл 2026",  venue:"Кроп Арена",          city:"Волгоград", cat:"concert", status:"pending",   price:"от 1500 ₽", icon:"🎸"},
  {id:"e7",  title:"Детский цирк «Огни»",         date:"22 июн 2026", venue:"Цирк",               city:"Волгоград", cat:"kids",    status:"pending",   price:"от 500 ₽",  icon:"🎪"},
  {id:"e8",  title:"Выставка современного искусства",date:"1 июл 2026", venue:"Музей ИЗО",         city:"Волгоград", cat:"exhibit", status:"pending",   price:"от 300 ₽",  icon:"🖼️"},
  {id:"e9",  title:"Би-2 — живой концерт",         date:"10 авг 2026", venue:"ЭКСПО Арена",        city:"Волгоград", cat:"concert", status:"approved",  price:"от 2000 ₽", icon:"🎤"},
  {id:"e10", title:"Стендап вечер",               date:"18 июн 2026", venue:"Ресторан арт-гостиная",city:"Волгоград",cat:"concert", status:"approved",  price:"от 700 ₽",  icon:"🎙️"},
];

const SEED_USERS = [
  {id:"u1", name:"Администратор",    email:"admin@afishi.ru",     role:"admin",     city:"Волгоград", reg:"01.01.2024"},
  {id:"u2", name:"Анна Ковалёва",    email:"anna@mail.ru",        role:"user",      city:"Волгоград", reg:"15.03.2025"},
  {id:"u3", name:"Сергей Петров",    email:"sergey@gmail.com",    role:"user",      city:"Москва",    reg:"20.04.2025"},
  {id:"u4", name:"Мария Иванова",    email:"maria@yandex.ru",     role:"moderator", city:"Волгоград", reg:"10.02.2025"},
  {id:"u5", name:"Дмитрий Соколов",  email:"dmitry@mail.ru",      role:"user",      city:"Волгоград", reg:"05.06.2025"},
];

const TABS = [
  {id:"dashboard",   label:"📊 Дашборд"},
  {id:"events",      label:"🎪 Мероприятия"},
  {id:"pending",     label:"⏳ На модерации"},
  {id:"users",       label:"👥 Пользователи"},
  {id:"venues",      label:"🏛 Площадки"},
  {id:"analytics",   label:"📈 Аналитика"},
  {id:"settings",    label:"⚙️ Настройки"},
];

// ── Компоненты ────────────────────────────────────────────────

function Badge({children, color="gray"}) {
  const colors = {
    green: {bg:"#e8f5e9", text:"#2e7d32"},
    red:   {bg:"#ffebee", text:"#c62828"},
    yellow:{bg:"#fffde7", text:"#f57f17"},
    gray:  {bg:"#f5f5f5", text:"#616161"},
    blue:  {bg:"#e3f2fd", text:"#1565c0"},
  };
  const s = colors[color] || colors.gray;
  return (
    <span style={{background:s.bg,color:s.text,padding:"2px 8px",borderRadius:12,fontSize:11,fontWeight:700}}>
      {children}
    </span>
  );
}

function StatCard({icon, label, value, color="#c8102e"}) {
  return (
    <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:"20px 24px",minWidth:140}}>
      <div style={{fontSize:28,marginBottom:4}}>{icon}</div>
      <div style={{fontSize:28,fontWeight:700,color,fontFamily:"Oswald,sans-serif"}}>{value}</div>
      <div style={{fontSize:12,color:"#888",textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div>
    </div>
  );
}

function Button({children, onClick, variant="primary", small=false, disabled=false}) {
  const styles = {
    primary: {background:COLORS.red,  color:"#fff"},
    outline: {background:"transparent",color:COLORS.red,  border:`1.5px solid ${COLORS.red}`},
    ghost:   {background:"#f4f2ee",   color:"#444", border:"1px solid #e0e0e0"},
    success: {background:"#2e7d32",   color:"#fff"},
    danger:  {background:"#c62828",   color:"#fff"},
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{...styles[variant], padding: small ? "4px 12px" : "8px 18px",
        borderRadius:8, border:"none", cursor: disabled ? "default" : "pointer",
        fontSize: small ? 12 : 13, fontWeight:700, fontFamily:"inherit",
        opacity: disabled ? 0.5 : 1, transition:"opacity .15s"}}>
      {children}
    </button>
  );
}

// ── Вкладки ───────────────────────────────────────────────────

function Dashboard({events}) {
  const approved = events.filter(e=>e.status==="approved").length;
  const pending  = events.filter(e=>e.status==="pending").length;
  const concerts = events.filter(e=>e.cat==="concert").length;
  const theaters = events.filter(e=>e.cat==="theater").length;
  return (
    <div>
      <h2 style={{fontFamily:"Oswald,sans-serif",fontSize:22,margin:"0 0 20px"}}>📊 Дашборд</h2>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:32}}>
        <StatCard icon="🎪" label="Всего событий"  value={events.length}  color={COLORS.red}/>
        <StatCard icon="✅" label="Опубликовано"   value={approved} color="#2e7d32"/>
        <StatCard icon="⏳" label="На модерации"  value={pending}  color="#f57f17"/>
        <StatCard icon="🎤" label="Концертов"      value={concerts} color={COLORS.dark}/>
        <StatCard icon="🎭" label="Театр"          value={theaters} color={COLORS.gold}/>
      </div>
      <h3 style={{fontFamily:"Oswald,sans-serif",fontSize:16,margin:"0 0 12px"}}>Последние события</h3>
      <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,overflow:"hidden"}}>
        {events.slice(0,6).map((ev,i) => (
          <div key={ev.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",
            borderBottom: i<5 ? "1px solid #f0f0f0" : "none"}}>
            <span style={{fontSize:20}}>{ev.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14}}>{ev.title}</div>
              <div style={{fontSize:12,color:"#888"}}>{ev.venue} · {ev.date}</div>
            </div>
            <Badge color={ev.status==="approved"?"green":"yellow"}>
              {ev.status==="approved"?"✓ Опубл.":"Ожидает"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventsTab({events, setEvents, filter}) {
  const [search, setSearch] = useState("");
  const filtered = events
    .filter(e => filter === "all" ? true : e.status === filter)
    .filter(e => e.title.toLowerCase().includes(search.toLowerCase()) ||
                 e.venue.toLowerCase().includes(search.toLowerCase()));

  const approve = (id) => setEvents(ev => ev.map(e => e.id===id ? {...e, status:"approved"} : e));
  const reject  = (id) => setEvents(ev => ev.filter(e => e.id!==id));

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <h2 style={{fontFamily:"Oswald,sans-serif",fontSize:22,margin:0}}>
          {filter==="pending" ? "⏳ На модерации" : "🎪 Мероприятия"}
        </h2>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Поиск..."
          style={{padding:"6px 12px",border:"1px solid #e0e0e0",borderRadius:8,fontSize:13,width:200}}/>
      </div>
      {filtered.length === 0 && (
        <div style={{padding:40,textAlign:"center",color:"#888"}}>Нет мероприятий</div>
      )}
      <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,overflow:"hidden"}}>
        {filtered.map((ev,i) => (
          <div key={ev.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",
            borderBottom: i<filtered.length-1 ? "1px solid #f0f0f0" : "none"}}>
            <span style={{fontSize:22}}>{ev.icon}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:14,marginBottom:2}}>{ev.title}</div>
              <div style={{fontSize:12,color:"#888"}}>
                📍 {ev.venue} · 📅 {ev.date} · 🏙 {ev.city} · 💰 {ev.price}
              </div>
            </div>
            <Badge color={ev.status==="approved"?"green":"yellow"}>
              {ev.status==="approved"?"Опубликовано":"На модерации"}
            </Badge>
            {ev.status === "pending" && (
              <div style={{display:"flex",gap:6}}>
                <Button small variant="success" onClick={()=>approve(ev.id)}>✓ Одобрить</Button>
                <Button small variant="danger"  onClick={()=>reject(ev.id)}>✕ Отклонить</Button>
              </div>
            )}
            {ev.status === "approved" && (
              <Button small variant="ghost" onClick={()=>reject(ev.id)}>Удалить</Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersTab({users, setUsers}) {
  const roleColor = {admin:"red", moderator:"blue", user:"gray"};
  return (
    <div>
      <h2 style={{fontFamily:"Oswald,sans-serif",fontSize:22,margin:"0 0 16px"}}>👥 Пользователи</h2>
      <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 100px 80px",
          padding:"8px 16px",background:"#f9f9f9",borderBottom:"1px solid #e0e0e0",
          fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>
          <span>Имя</span><span>Email</span><span>Роль</span><span>Город</span><span>Действия</span>
        </div>
        {users.map((u,i) => (
          <div key={u.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 100px 80px",
            alignItems:"center",padding:"10px 16px",
            borderBottom: i<users.length-1 ? "1px solid #f0f0f0" : "none", fontSize:13}}>
            <span style={{fontWeight:600}}>{u.name}</span>
            <span style={{color:"#666"}}>{u.email}</span>
            <Badge color={roleColor[u.role]||"gray"}>{u.role}</Badge>
            <span style={{color:"#888"}}>{u.city}</span>
            <Button small variant="ghost" onClick={()=>setUsers(us=>us.filter(x=>x.id!==u.id))}>
              Удалить
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function VenuesTab() {
  const venues = [
    {name:"ЦКЗ Волгоградская Филармония", addr:"Набережная 62-й Армии, 4", cap:1040, cat:"concert"},
    {name:"Кроп Арена",                   addr:"ул. Маршала Чуйкова, 1",   cap:45000,cat:"stadium"},
    {name:"Дом Офицеров",                 addr:"пр. Ленина, 10",           cap:600,  cat:"concert"},
    {name:"Театр НЭТ",                    addr:"ул. Мира, 5",             cap:380,  cat:"theater"},
    {name:"ТЮЗ Волгоград",               addr:"пр. Ленина, 15",          cap:400,  cat:"theater"},
    {name:"Царицынская Опера",            addr:"ул. Мира, 4",             cap:860,  cat:"opera"},
    {name:"Музыкальный Театр",            addr:"пр. Ленина, 28",          cap:850,  cat:"musical"},
    {name:"Цирк Волгограда",              addr:"пр. Ленина, 65",          cap:1800, cat:"circus"},
    {name:"Музей ИЗО",                    addr:"пр. Ленина, 21",          cap:null, cat:"museum"},
    {name:"ЭКСПО Арена",                  addr:"ул. Ангарская, 107",      cap:6500, cat:"expo"},
  ];
  return (
    <div>
      <h2 style={{fontFamily:"Oswald,sans-serif",fontSize:22,margin:"0 0 16px"}}>🏛 Площадки Волгограда</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
        {venues.map((v,i)=>(
          <div key={i} style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:16}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{v.name}</div>
            <div style={{fontSize:12,color:"#888",marginBottom:8}}>📍 {v.addr}</div>
            {v.cap && <div style={{fontSize:12,color:"#666"}}>👥 {v.cap.toLocaleString("ru")} мест</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsTab({events}) {
  const byCity = {};
  const byCat  = {};
  events.filter(e=>e.status==="approved").forEach(e => {
    byCity[e.city] = (byCity[e.city]||0)+1;
    byCat[e.cat]   = (byCat[e.cat]||0)+1;
  });
  const catLabels = {concert:"🎤 Концерты",theater:"🎭 Театр",kids:"🧒 Дети",exhibit:"🖼️ Выставки",cinema:"🎬 Кино"};
  return (
    <div>
      <h2 style={{fontFamily:"Oswald,sans-serif",fontSize:22,margin:"0 0 20px"}}>📈 Аналитика</h2>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
        <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:20}}>
          <h3 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>По городам</h3>
          {Object.entries(byCity).sort((a,b)=>b[1]-a[1]).map(([city,cnt])=>(
            <div key={city} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{flex:1,fontSize:13}}>{city}</span>
              <div style={{background:"#f0f0f0",borderRadius:4,height:8,flex:2}}>
                <div style={{background:COLORS.red,borderRadius:4,height:8,
                  width:`${(cnt/events.length*100).toFixed(0)}%`}}/>
              </div>
              <span style={{fontSize:12,color:"#888",width:24,textAlign:"right"}}>{cnt}</span>
            </div>
          ))}
        </div>
        <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:20}}>
          <h3 style={{margin:"0 0 12px",fontSize:14,fontWeight:700}}>По категориям</h3>
          {Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cat,cnt])=>(
            <div key={cat} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{flex:1,fontSize:13}}>{catLabels[cat]||cat}</span>
              <div style={{background:"#f0f0f0",borderRadius:4,height:8,flex:2}}>
                <div style={{background:COLORS.gold,borderRadius:4,height:8,
                  width:`${(cnt/events.length*100).toFixed(0)}%`}}/>
              </div>
              <span style={{fontSize:12,color:"#888",width:24,textAlign:"right"}}>{cnt}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{marginTop:24,background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:20}}>
        <h3 style={{margin:"0 0 8px",fontSize:14,fontWeight:700}}>Яндекс.Метрика</h3>
        <p style={{fontSize:13,color:"#888",margin:0}}>
          Счётчик ID <strong>2234293</strong> — данные доступны на{" "}
          <a href="https://metrika.yandex.ru" target="_blank" style={{color:COLORS.red}}>metrika.yandex.ru</a>
        </p>
      </div>
    </div>
  );
}

function SettingsTab() {
  const [saved, setSaved] = useState(false);
  const save = () => { setSaved(true); setTimeout(()=>setSaved(false), 2000); };
  return (
    <div>
      <h2 style={{fontFamily:"Oswald,sans-serif",fontSize:22,margin:"0 0 20px"}}>⚙️ Настройки</h2>
      <div style={{display:"grid",gap:16}}>
        {[
          {label:"Название сайта",  val:"Афиши.ру — Волгоград"},
          {label:"Домен",           val:"afishi.ru"},
          {label:"Email для уведомлений", val:"strote34@gmail.com"},
          {label:"Яндекс.Метрика ID",     val:"2234293"},
          {label:"Worker URL",            val:"https://afishi-geo.strote34.workers.dev"},
        ].map((s,i)=>(
          <div key={i} style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:10,padding:16}}>
            <label style={{display:"block",fontSize:12,fontWeight:700,color:"#888",marginBottom:6,textTransform:"uppercase"}}>
              {s.label}
            </label>
            <input defaultValue={s.val}
              style={{width:"100%",padding:"8px 12px",border:"1px solid #e0e0e0",borderRadius:8,
                fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}/>
          </div>
        ))}
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <Button onClick={save}>💾 Сохранить</Button>
          {saved && <span style={{color:"#2e7d32",fontSize:13}}>✓ Сохранено</span>}
        </div>
      </div>
    </div>
  );
}

// ── Главный компонент ─────────────────────────────────────────

export default function AdminPanel() {
  const [auth,   setAuth]   = useState(false);
  const [email,  setEmail]  = useState("");
  const [pass,   setPass]   = useState("");
  const [error,  setError]  = useState("");
  const [tab,    setTab]    = useState("dashboard");
  const [events, setEvents] = useState(SEED_EVENTS);
  const [users,  setUsers]  = useState(SEED_USERS);
  const [menuOpen, setMenuOpen] = useState(false);

  const login = () => {
    if (email === ADMIN_EMAIL && pass === ADMIN_PASS) {
      setAuth(true); setError("");
    } else {
      setError("Неверный email или пароль");
    }
  };

  const pendingCount = events.filter(e=>e.status==="pending").length;

  if (!auth) return (
    <div style={{minHeight:"100vh",background:COLORS.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:16,padding:"40px 36px",width:360,
        boxShadow:"0 4px 24px rgba(0,0,0,.08)"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:36,marginBottom:8}}>🔐</div>
          <div style={{fontFamily:"Oswald,sans-serif",fontSize:24,fontWeight:700,color:COLORS.dark}}>
            Афиши.ру Admin
          </div>
          <div style={{fontSize:13,color:"#888",marginTop:4}}>Панель управления</div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#888",marginBottom:4}}>EMAIL</label>
          <input value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&login()}
            placeholder="admin@afishi.ru"
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e0e0e0",borderRadius:8,
              fontSize:14,boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:16}}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#888",marginBottom:4}}>ПАРОЛЬ</label>
          <input value={pass} onChange={e=>setPass(e.target.value)} type="password"
            onKeyDown={e=>e.key==="Enter"&&login()}
            placeholder="••••••••"
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e0e0e0",borderRadius:8,
              fontSize:14,boxSizing:"border-box"}}/>
        </div>
        {error && <div style={{color:COLORS.red,fontSize:13,marginBottom:12,textAlign:"center"}}>{error}</div>}
        <button onClick={login}
          style={{width:"100%",padding:"12px",background:COLORS.red,color:"#fff",border:"none",
            borderRadius:10,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"Oswald,sans-serif",
            textTransform:"uppercase",letterSpacing:"0.05em"}}>
          Войти
        </button>
        <div style={{marginTop:16,padding:"12px",background:"#f9f9f9",borderRadius:8,fontSize:12,color:"#888"}}>
          <strong>Demo:</strong> admin@afishi.ru / Afishi2018!
        </div>
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",minHeight:"100vh",background:COLORS.bg,fontFamily:"-apple-system,sans-serif"}}>
      {/* Sidebar */}
      <div style={{width:220,background:COLORS.dark,color:"#fff",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"20px 16px 16px",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
          <div style={{fontFamily:"Oswald,sans-serif",fontSize:20,fontWeight:700,color:"#fff"}}>
            А <span style={{color:COLORS.red}}>·</span> Admin
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>afishi.ru</div>
        </div>
        <nav style={{flex:1,padding:"12px 8px"}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"9px 12px",border:"none",borderRadius:8,cursor:"pointer",textAlign:"left",
                fontSize:13,fontWeight:600,marginBottom:2,
                background: tab===t.id ? "rgba(200,16,46,.3)" : "transparent",
                color: tab===t.id ? "#fff" : "rgba(255,255,255,.6)",
                transition:"all .15s"}}>
              <span>{t.label}</span>
              {t.id==="pending" && pendingCount>0 &&
                <span style={{background:COLORS.red,color:"#fff",borderRadius:10,
                  padding:"1px 6px",fontSize:10,fontWeight:700}}>{pendingCount}</span>}
            </button>
          ))}
        </nav>
        <div style={{padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,.1)"}}>
          <button onClick={()=>setAuth(false)}
            style={{width:"100%",padding:"8px",background:"rgba(255,255,255,.1)",color:"rgba(255,255,255,.7)",
              border:"none",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>
            🚪 Выйти
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,overflow:"auto",padding:24}}>
        {tab==="dashboard" && <Dashboard events={events}/>}
        {tab==="events"    && <EventsTab events={events} setEvents={setEvents} filter="all"/>}
        {tab==="pending"   && <EventsTab events={events} setEvents={setEvents} filter="pending"/>}
        {tab==="users"     && <UsersTab  users={users}   setUsers={setUsers}/>}
        {tab==="venues"    && <VenuesTab/>}
        {tab==="analytics" && <AnalyticsTab events={events}/>}
        {tab==="settings"  && <SettingsTab/>}
      </div>
    </div>
  );
}
