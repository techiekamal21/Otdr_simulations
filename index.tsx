import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Activity, 
  Settings, 
  Scissors, 
  Zap, 
  Play, 
  Square, 
  Trash2, 
  AlertTriangle,
  Info,
  X as XIcon,
  Circle as CircleIcon,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  MoveHorizontal,
  Waves,
  MousePointer2,
  Calculator,
  Server,
  ArrowRight,
  TrendingDown,
  Ruler,
  ZapOff,
  Timer,
  Clock
} from 'lucide-react';

// --- Types & Constants ---

type EventType = 'connector' | 'splice' | 'bend' | 'end' | 'cut' | 'start' | 'degradation';

interface FiberEvent {
  id: string;
  type: EventType;
  distance: number; // km
  loss: number; // dB
  reflectance: number; // dB (negative value, e.g., -40)
}

interface SimulationConfig {
  range: number; // km
  pulseWidth: number; // ns
  wavelength: 1310 | 1550; // nm
  ior: number; // Index of Refraction
  averaging: number; // Deprecated in favor of time-based, but kept for calculation scaling
  noiseFloor: number; // dB
  autoMode: boolean;
  testDuration: number; // seconds, 0 = Continuous
}

interface TracePoint {
  x: number; // distance km
  y: number; // power dB
}

interface ViewState {
    start: number; // km
    end: number; // km
}

interface Signal {
    id: string;
    x: number; // percentage 0-100
    direction: 1 | -1; // 1 = forward, -1 = backward
    type: 'pulse' | 'reflection';
    opacity: number;
}

// Physics Constants
const C = 299792.458; // Speed of light in vacuum (km/s)

// --- Helper Functions ---

const generateId = () => Math.random().toString(36).substr(2, 9);

// --- Components ---

const EventIconSVG = ({ type, color, size = 16 }: { type: EventType, color: string, size?: number }) => {
    const s = size / 2;
    switch (type) {
        case 'connector':
            return (
                <g stroke={color} strokeWidth="2" fill="none">
                    <rect x={-s + 2} y={-s + 2} width={size - 4} height={size - 4} />
                    <line x1="0" y1={-s} x2="0" y2={s} />
                </g>
            );
        case 'splice':
            return (
                <path d={`M ${-s+2} ${-s+2} L ${s-2} ${s-2} M ${-s+2} ${s-2} L ${s-2} ${-s+2}`} stroke={color} strokeWidth="2" fill="none" />
            );
        case 'bend':
            return (
                <circle r={s - 2} stroke={color} strokeWidth="2" fill="none" />
            );
        case 'degradation':
             return (
                <path d={`M ${-s} 0 Q ${-s/2} ${-s} 0 0 T ${s} 0`} stroke={color} strokeWidth="2" fill="none" />
             );
        case 'cut':
            return (
                 <path d={`M 0 ${-s} L ${-s/2} ${-s/3} L ${s/2} ${s/3} L 0 ${s}`} stroke={color} strokeWidth="2" fill="none" />
            );
        case 'end':
            return (
                <line x1="0" y1={-s} x2="0" y2={s} stroke={color} strokeWidth="4" />
            );
        case 'start':
            return (
                <circle r={s - 2} fill={color} />
            );
        default:
            return <circle r={s/2} fill={color} />;
    }
};

const EventIconHTML = ({ type, className }: { type: EventType, className?: string }) => {
    switch(type) {
        case 'connector': return <div className={`relative ${className}`}><Square size={16} /><div className="absolute inset-0 flex items-center justify-center"><div className="w-0.5 h-full bg-current"></div></div></div>;
        case 'splice': return <XIcon size={16} className={className} />;
        case 'bend': return <CircleIcon size={16} className={className} />;
        case 'degradation': return <Waves size={16} className={className} />;
        case 'cut': return <Zap size={16} className={className} />;
        case 'end': return <Maximize2 size={16} className={`${className} rotate-90`} />;
        case 'start': return <CircleIcon size={16} fill="currentColor" className={className} />;
        default: return <div className={`w-3 h-3 rounded-full ${className}`} />;
    }
};

const PhysicsCard = ({ title, value, unit, subtext, formula, icon: Icon }: any) => (
    <div className="bg-slate-900 border border-slate-700 rounded p-3 flex flex-col gap-1 relative overflow-hidden group">
        <div className="absolute right-2 top-2 text-slate-700 opacity-20 group-hover:opacity-40 transition-opacity">
            {Icon && <Icon size={40} />}
        </div>
        <div className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-2">
            {title}
        </div>
        <div className="text-xl font-mono text-green-400 font-bold">
            {value} <span className="text-sm text-green-600">{unit}</span>
        </div>
        {formula && (
            <div className="text-[9px] text-slate-500 font-mono mt-1 border-t border-slate-800 pt-1">
                {formula}
            </div>
        )}
        {subtext && <div className="text-[9px] text-slate-600 italic">{subtext}</div>}
    </div>
);


const App = () => {
  // --- State ---
  
  const [config, setConfig] = useState<SimulationConfig>({
    range: 20,
    pulseWidth: 100,
    wavelength: 1550,
    ior: 1.4682,
    averaging: 1,
    noiseFloor: -60,
    autoMode: true,
    testDuration: 15 // Default 15s
  });

  const [events, setEvents] = useState<FiberEvent[]>([
    { id: 'start', type: 'start', distance: 0, loss: 0.5, reflectance: -35 },
    { id: 'e1', type: 'splice', distance: 5.2, loss: 0.1, reflectance: -99 }, 
    { id: 'e2', type: 'connector', distance: 12.5, loss: 0.5, reflectance: -40 },
    { id: 'end', type: 'end', distance: 18.0, loss: 0, reflectance: -14 },
  ]);

  const [activeCut, setActiveCut] = useState<{ distance: number } | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [traceData, setTraceData] = useState<TracePoint[]>([]);
  const [detectedEvents, setDetectedEvents] = useState<any[]>([]);
  const [cursor, setCursor] = useState<{x: number, y: number} | null>(null);
  
  // Real-time Averaging State
  const [elapsedTime, setElapsedTime] = useState(0);
  const [accumulatedY, setAccumulatedY] = useState<number[]>([]);
  const [sampleCount, setSampleCount] = useState(0);

  // Visualization Signals
  const [signals, setSignals] = useState<Signal[]>([]);
  
  // Graph View State
  const [viewState, setViewState] = useState<ViewState>({ start: 0, end: 20 });
  
  const animationRef = useRef<number>();
  const signalRef = useRef<Signal[]>([]); // Ref to hold signals for animation loop without re-render lag
  const nextPulseTime = useRef(0);

  // --- Auto Mode Logic ---
  useEffect(() => {
    if (config.autoMode) {
        // Determine max distance
        let maxDist = 0;
        const lastEvent = events.find(e => e.type === 'end');
        if (lastEvent) maxDist = lastEvent.distance;
        if (activeCut && activeCut.distance < maxDist) maxDist = activeCut.distance;

        // Auto Range
        const availableRanges = [5, 10, 20, 40, 80, 160, 300];
        const bestRange = availableRanges.find(r => r > maxDist * 1.2) || 300;

        // Auto Pulse Width
        let bestPulse = 100;
        if (bestRange <= 5) bestPulse = 10;
        else if (bestRange <= 20) bestPulse = 100;
        else if (bestRange <= 40) bestPulse = 500;
        else if (bestRange <= 80) bestPulse = 1000;
        else if (bestRange <= 160) bestPulse = 10000;
        else bestPulse = 20000;

        if (config.range !== bestRange || config.pulseWidth !== bestPulse) {
            setConfig(prev => ({ ...prev, range: bestRange, pulseWidth: bestPulse }));
            setViewState({ start: 0, end: bestRange }); // Reset view on auto change
        }
    }
  }, [config.autoMode, events, activeCut]); 

  // --- Physics Engine ---

  const calculateAttenuation = (wavelength: number) => {
    return wavelength === 1310 ? 0.35 : 0.20;
  };

  // Generates a single NOISY trace
  const calculateSingleTrace = () => {
    const numPoints = 4000; 
    const stepSize = config.range / numPoints; 
    const attenuationCoeff = calculateAttenuation(config.wavelength);
    
    // Pulse/Dead Zone Physics
    const groupIndex = config.ior;
    const speedOfLightKmS = 299792.458;
    const pulseWidthSeconds = config.pulseWidth * 1e-9;
    const pulseLengthKm = (speedOfLightKmS * pulseWidthSeconds) / groupIndex;
    const eventDeadZone = pulseLengthKm * 1.5;

    // Noise: Less averaging = more raw noise
    // We simulate a single "shot" here, which is very noisy
    const baseNoiseAmp = 5.0; // High base noise for single shot
    const noiseReductionFactor = Math.log10(config.pulseWidth) / 2;
    const noiseAmplitude = Math.max(0.5, baseNoiseAmp / (noiseReductionFactor || 1));

    // Prepare Events
    let sortedEvents = [...events].sort((a, b) => a.distance - b.distance);
    let effectiveEndDistance = sortedEvents.find(e => e.type === 'end')?.distance || config.range;

    if (activeCut) {
        effectiveEndDistance = activeCut.distance;
        sortedEvents = sortedEvents.filter(e => e.distance < activeCut.distance);
        sortedEvents.push({
            id: 'cut-point',
            type: 'cut',
            distance: activeCut.distance,
            loss: 50, 
            reflectance: -14 
        });
    }

    const yValues = new Float32Array(numPoints);
    let currentPower = 0; 
    let eventIndex = 0;
    
    let deadZoneActiveUntil = -1;
    let powerAtSaturation = 0;

    for (let i = 0; i < numPoints; i++) {
      const d = i * stepSize;
      
      let idealPower = currentPower - (attenuationCoeff * d);
      
      const activeEvent = sortedEvents[eventIndex];
      let reflectionAdd = 0;
      let justTriggeredEvent = false;

      if (activeEvent && d >= activeEvent.distance) {
          currentPower -= activeEvent.loss;
          idealPower -= activeEvent.loss; 

          if (activeEvent.reflectance > -65) {
               const spikeHeight = (activeEvent.reflectance + 75); 
               deadZoneActiveUntil = activeEvent.distance + eventDeadZone;
               powerAtSaturation = idealPower + spikeHeight;
               reflectionAdd = spikeHeight;
          }
          justTriggeredEvent = true;
          eventIndex++;
      }

      let traceValue = idealPower;
      
      if (d < deadZoneActiveUntil) {
          const remainingDist = deadZoneActiveUntil - d;
          const ratio = remainingDist / (eventDeadZone || 0.001); 
          const decay = Math.pow(ratio, 4) * (powerAtSaturation - idealPower);
          traceValue = idealPower + decay;
      } else {
          deadZoneActiveUntil = -1;
      }

      if (justTriggeredEvent) {
          traceValue += reflectionAdd;
      }

      if (d > effectiveEndDistance) {
         traceValue = config.noiseFloor;
      }

      // Add Random Noise for this "shot"
      const noise = (Math.random() - 0.5) * noiseAmplitude;
      let finalPower = traceValue + noise;
      
      if (finalPower < config.noiseFloor) finalPower = config.noiseFloor + noise;
      yValues[i] = finalPower;
    }

    return yValues;
  };

  // --- Animation & Simulation Loop ---

  const startSimulation = () => {
      setIsSimulating(true);
      setSampleCount(0);
      setAccumulatedY([]); // Reset average
      setElapsedTime(0);
      signalRef.current = []; // Clear signals
      nextPulseTime.current = 0;
  };

  const stopSimulation = () => {
      setIsSimulating(false);
      signalRef.current = [];
      setSignals([]);
      analyzeTrace(); // Final analysis on stop
  };

  useEffect(() => {
    let startTime = performance.now();
    let lastSignalUpdate = performance.now();

    const loop = (timestamp: number) => {
      if (!isSimulating) return;

      const deltaSeconds = (timestamp - startTime) / 1000;

      // 1. Time Check
      if (config.testDuration > 0 && deltaSeconds >= config.testDuration) {
          setElapsedTime(config.testDuration);
          stopSimulation();
          return;
      }
      setElapsedTime(deltaSeconds);

      // 2. Data Acquisition (Averaging)
      // We simulate multiple "shots" per frame to speed up averaging if needed, 
      // but 1 per frame creates a nice visual effect of "cleaning up".
      const newRawTrace = calculateSingleTrace();
      
      setAccumulatedY(prev => {
          if (prev.length === 0) return Array.from(newRawTrace);
          
          const newAcc = new Float32Array(prev.length);
          // Standard cumulative average formula: Avg_n = ((Avg_n-1 * (n-1)) + x_n) / n
          // But to avoid floating point drift, we can just sum them if we knew the total count?
          // Let's use the iterative approach which is robust enough here.
          // Or weighted average: 95% old, 5% new? 
          // Real averaging: we need sampleCount.
          
          return prev.map((val, i) => val + newRawTrace[i]); // Just Sum for now
      });
      setSampleCount(c => c + 1);

      // 3. Signal Visualization Logic
      const now = timestamp;
      const dt = now - lastSignalUpdate;
      lastSignalUpdate = now;

      // Spawn Pulse periodically
      if (now > nextPulseTime.current) {
          signalRef.current.push({
              id: generateId(),
              x: 0,
              direction: 1,
              type: 'pulse',
              opacity: 1
          });
          nextPulseTime.current = now + 800; // Pulse every 800ms
      }

      // Move Signals
      const speed = 0.05 * (dt / 16); // Speed factor
      let activeSignals = signalRef.current;
      
      // Filter out completed signals
      activeSignals = activeSignals.filter(s => s.x >= 0 && s.x <= 100 && s.opacity > 0.05);

      // Update positions & Check Collisions
      const eventsList = activeCut 
        ? [...events.filter(e => e.distance < activeCut.distance), { id:'cut', type:'cut', distance: activeCut.distance, reflectance: -14 }] 
        : events;
      
      activeSignals.forEach(s => {
          const oldX = s.x;
          s.x += s.direction * speed;
          
          // Fade based on distance
          s.opacity -= 0.002;

          // Check collisions if moving forward
          if (s.direction === 1 && s.type === 'pulse') {
             // Check if we passed an event
             const distKm = (s.x / 100) * config.range;
             const oldDistKm = (oldX / 100) * config.range;
             
             eventsList.forEach(e => {
                 if (e.reflectance > -60 && e.distance >= oldDistKm && e.distance <= distKm) {
                     // Spawn Reflection
                     signalRef.current.push({
                         id: generateId(),
                         x: s.x,
                         direction: -1,
                         type: 'reflection',
                         opacity: Math.min(1, (e.reflectance + 70) / 40) // Opacity based on strength
                     });
                 }
             });
          }
      });

      signalRef.current = activeSignals;
      setSignals([...activeSignals]); // Trigger render for Visuals

      animationRef.current = requestAnimationFrame(loop);
    };

    if (isSimulating) {
      startTime = performance.now() - (elapsedTime * 1000); // Resume correct time
      loop(performance.now());
    } 

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isSimulating, config, events, activeCut]); // Dependencies


  // Compute Display Trace from Accumulator
  useEffect(() => {
      if (accumulatedY.length > 0 && sampleCount > 0) {
           const numPoints = accumulatedY.length;
           const stepSize = config.range / numPoints; 
           const displayData: TracePoint[] = [];
           for(let i=0; i<numPoints; i++) {
               displayData.push({
                   x: i * stepSize,
                   y: accumulatedY[i] / sampleCount
               });
           }
           setTraceData(displayData);
      } else if (!isSimulating && traceData.length === 0) {
          // Initial static trace
          const raw = calculateSingleTrace();
          const numPoints = raw.length;
          const stepSize = config.range / numPoints;
          const displayData: TracePoint[] = [];
           for(let i=0; i<numPoints; i++) {
               displayData.push({ x: i * stepSize, y: raw[i] });
           }
          setTraceData(displayData);
          analyzeTrace();
      }
  }, [accumulatedY, sampleCount, isSimulating, config.range]); // Only re-calc when data changes


  const analyzeTrace = () => {
    const detected = [];
    let currentLossTotal = 0;
    
    let actualEvents = [...events];
    if (activeCut) {
        actualEvents = actualEvents.filter(e => e.distance < activeCut.distance);
        actualEvents.push({ id: 'cut', type: 'cut', distance: activeCut.distance, loss: 0, reflectance: -14 });
    }
    actualEvents.sort((a, b) => a.distance - b.distance);

    for (let i = 0; i < actualEvents.length; i++) {
        const e = actualEvents[i];
        if (e.type === 'start') continue; 

        currentLossTotal += e.loss;
        const prevDist = i === 0 ? 0 : actualEvents[i-1].distance;
        const sectionLen = e.distance - prevDist;
        const sectionLoss = sectionLen * calculateAttenuation(config.wavelength);
        currentLossTotal += sectionLoss;

        detected.push({
            no: i,
            type: e.type,
            location: e.distance.toFixed(4),
            reflectance: e.reflectance > -60 ? e.reflectance.toFixed(2) : '---',
            loss: e.type === 'cut' ? '> 50.0' : e.loss.toFixed(3),
            cumLoss: currentLossTotal.toFixed(3)
        });
    }
    setDetectedEvents(detected);
  };

  // --- Handlers ---

  const handleAddEvent = (type: EventType) => {
    const lastEvent = events.find(e => e.type === 'end') || events[events.length-1];
    let maxDist = lastEvent ? lastEvent.distance : 20;
    if (activeCut) maxDist = activeCut.distance;
    
    const newDist = Math.random() * (maxDist * 0.8) + (maxDist * 0.1);
    
    const newEvent: FiberEvent = {
        id: generateId(),
        type,
        distance: parseFloat(newDist.toFixed(3)),
        loss: type === 'splice' ? 0.05 : type === 'degradation' ? 1.5 : 0.5,
        reflectance: type === 'connector' ? -40 : -99
    };
    
    const newEvents = [...events];
    const endIndex = newEvents.findIndex(e => e.type === 'end');
    if (endIndex !== -1) {
        newEvents.splice(endIndex, 0, newEvent);
    } else {
        newEvents.push(newEvent);
    }
    setEvents(newEvents);
  };

  const handleCutFiber = () => {
    if (activeCut) {
        setActiveCut(null); 
    } else {
        const endDist = events.find(e => e.type === 'end')?.distance || config.range;
        setActiveCut({ distance: endDist * 0.6 }); 
    }
  };

  const handleUpdateEvent = (id: string, field: keyof FiberEvent, value: number) => {
    setEvents(events.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const handleDeleteEvent = (id: string) => {
    if (id === 'start' || id === 'end') return;
    setEvents(events.filter(e => e.id !== id));
  };

  // --- Graph Zoom & Pan Handlers ---
  
  const handleZoom = (direction: 'in' | 'out') => {
      const currentRange = viewState.end - viewState.start;
      const center = viewState.start + currentRange / 2;
      let newRange = direction === 'in' ? currentRange / 1.5 : currentRange * 1.5;
      
      // Clamp range
      if (newRange < 0.1) newRange = 0.1; // Min zoom 100m
      if (newRange > config.range) newRange = config.range;

      let newStart = center - newRange / 2;
      let newEnd = center + newRange / 2;

      // Clamp bounds
      if (newStart < 0) {
          newStart = 0;
          newEnd = newRange;
      }
      if (newEnd > config.range) {
          newEnd = config.range;
          newStart = config.range - newRange;
      }
      
      // Safety if range is effectively full
      if (newRange >= config.range) {
          newStart = 0;
          newEnd = config.range;
      }

      setViewState({ start: newStart, end: newEnd });
  };

  const handleScroll = (e: React.ChangeEvent<HTMLInputElement>) => {
      const centerPerc = parseFloat(e.target.value); // 0 to 1
      const currentRange = viewState.end - viewState.start;
      const rangeCenter = config.range * centerPerc;
      
      let newStart = rangeCenter - currentRange / 2;
      let newEnd = rangeCenter + currentRange / 2;

      if (newStart < 0) { newStart = 0; newEnd = currentRange; }
      if (newEnd > config.range) { newEnd = config.range; newStart = config.range - currentRange; }

      setViewState({ start: newStart, end: newEnd });
  };

  const resetZoom = () => {
      setViewState({ start: 0, end: config.range });
  };


  // --- Visualization Constants & Transform ---
  const GRAPH_WIDTH = 1000;
  const GRAPH_HEIGHT = 500;
  const MIN_DB = config.noiseFloor - 10;
  const MAX_DB = 15; 
  
  // Dynamic scaling based on viewState
  const viewRange = viewState.end - viewState.start;
  const xScale = GRAPH_WIDTH / viewRange;
  const yScale = GRAPH_HEIGHT / (Math.abs(MIN_DB) + MAX_DB);

  // Function to map KM to Pixels based on Zoom
  const kmToPx = (km: number) => {
      return (km - viewState.start) * xScale;
  };

  const getChartPath = () => {
    if (traceData.length === 0) return '';
    
    // Start path
    let d = '';
    let firstPoint = true;

    // Iterate points only within view + buffer
    const step = config.range / 4000;
    const startIndex = Math.max(0, Math.floor(viewState.start / step));
    const endIndex = Math.min(traceData.length - 1, Math.ceil(viewState.end / step));

    for (let i = startIndex; i <= endIndex; i++) {
        const point = traceData[i];
        const x = kmToPx(point.x);
        const y = GRAPH_HEIGHT - (point.y - MIN_DB) * yScale;
        
        if (firstPoint) {
            d = `M ${x} ${y}`;
            firstPoint = false;
        } else {
            d += ` L ${x} ${y}`;
        }
    }
    return d;
  };

  const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    
    // Inverse map px to km
    const dist = (xPx / rect.width) * viewRange + viewState.start;
    
    // Find closest Y in data
    const step = config.range / 4000;
    const idx = Math.floor(dist / step);
    const point = traceData[Math.min(Math.max(0, idx), traceData.length-1)];

    if (point) {
        setCursor({ x: dist, y: point.y });
    }
  };

  const visualizationEvents = useMemo(() => {
     let displayEvents = [...events];
     if (activeCut) {
        displayEvents = displayEvents.filter(e => e.distance < activeCut.distance);
        displayEvents.push({ 
            id: 'active-cut', 
            type: 'cut', 
            distance: activeCut.distance, 
            loss: 50, 
            reflectance: -14 
        });
     }
     return displayEvents.sort((a,b) => a.distance - b.distance);
  }, [events, activeCut]);

  // --- Calculations for Physics Panel ---
  const pulseWidthS = config.pulseWidth * 1e-9;
  const speedOfLightFiber = 299792458 / config.ior; // m/s
  // Pulse Length (Spatial Width) = v * t
  const pulseLengthM = speedOfLightFiber * pulseWidthS;
  // Resolution (Two-point) is half pulse length
  const resolutionM = pulseLengthM / 2;
  // Event Dead Zone (Approx)
  const eventDeadZoneM = pulseLengthM * 1.5;
  // Attenuation Dead Zone (Approx)
  const attenDeadZoneM = pulseLengthM * 4.0;
  // Sampling Resolution
  const samplingResM = (config.range * 1000) / 4000;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-4 md:p-6">
      <header className="mb-4 flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-green-500 flex items-center gap-2">
            <Activity className="h-6 w-6" /> Pro OTDR Simulator
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            {config.range}km / {config.pulseWidth}ns / {config.wavelength}nm / IOR {config.ior}
          </p>
        </div>
        <div className="flex gap-2">
            <div className="flex items-center gap-2 mr-4 bg-slate-900 px-3 py-1 rounded border border-slate-800">
                <input 
                    type="checkbox" 
                    id="autoMode"
                    checked={config.autoMode}
                    onChange={(e) => setConfig({...config, autoMode: e.target.checked})}
                    className="accent-green-500"
                />
                <label htmlFor="autoMode" className="text-sm font-bold text-green-400 cursor-pointer flex items-center gap-1">
                    <RefreshCw size={12} /> AUTO
                </label>
            </div>
            
            {/* Progress Bar for Active Simulation */}
            {isSimulating && config.testDuration > 0 && (
                <div className="flex flex-col justify-center mr-4 w-32">
                    <div className="flex justify-between text-[10px] text-green-400 mb-1">
                        <span>{elapsedTime.toFixed(1)}s</span>
                        <span>{config.testDuration}s</span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-green-500 transition-all duration-200 ease-linear"
                            style={{ width: `${(elapsedTime / config.testDuration) * 100}%` }}
                        ></div>
                    </div>
                </div>
            )}

            <button 
                onClick={() => isSimulating ? stopSimulation() : startSimulation()}
                className={`flex items-center gap-2 px-4 py-2 rounded font-bold text-sm transition-all shadow-lg ${isSimulating ? 'bg-red-500/90 hover:bg-red-600 text-white' : 'bg-green-600 hover:bg-green-500 text-white'}`}
            >
                {isSimulating ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                {isSimulating ? 'STOP' : 'START TEST'}
            </button>
            <button 
                onClick={handleCutFiber}
                className={`flex items-center gap-2 px-4 py-2 rounded font-bold text-sm transition-all shadow-lg ${activeCut ? 'bg-yellow-500 text-black' : 'bg-slate-800 hover:bg-red-500/80 hover:text-white border border-slate-700'}`}
            >
                <Scissors size={14} />
                {activeCut ? 'REPAIR' : 'CUT FIBER'}
            </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: Controls */}
        <div className="lg:col-span-3 space-y-4">
            
            {/* SETUP PANEL */}
            <div className={`bg-slate-900 rounded-lg p-4 border shadow-xl transition-colors ${config.autoMode ? 'border-green-900/50 opacity-80' : 'border-slate-700'}`}>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Settings size={12} /> {config.autoMode ? 'Auto Setup Active' : 'Manual Setup'}
                </h3>
                
                <div className={`space-y-4 ${config.autoMode ? 'pointer-events-none grayscale-[0.5]' : ''}`}>
                    <div>
                        <label className="block text-[10px] text-slate-500 mb-1 uppercase font-bold">Range</label>
                        <select 
                            value={config.range}
                            onChange={(e) => {
                                const newRange = Number(e.target.value);
                                setConfig({...config, range: newRange});
                                setViewState({start: 0, end: newRange});
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-green-400 font-mono focus:border-green-500 outline-none"
                        >
                            {[5, 10, 20, 40, 80, 160, 300].map(r => (
                                <option key={r} value={r}>{r} km</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] text-slate-500 mb-1 uppercase font-bold">Pulse Width</label>
                        <select 
                            value={config.pulseWidth}
                            onChange={(e) => setConfig({...config, pulseWidth: Number(e.target.value)})}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-green-400 font-mono focus:border-green-500 outline-none"
                        >
                            <option value={10}>10 ns (High Res)</option>
                            <option value={50}>50 ns</option>
                            <option value={100}>100 ns</option>
                            <option value={500}>500 ns</option>
                            <option value={1000}>1 µs</option>
                            <option value={10000}>10 µs</option>
                            <option value={20000}>20 µs (Max Range)</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] text-slate-500 mb-1 uppercase font-bold">Test Duration (Averaging)</label>
                        <div className="relative">
                            <select 
                                value={config.testDuration}
                                onChange={(e) => setConfig({...config, testDuration: Number(e.target.value)})}
                                disabled={isSimulating}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-green-400 font-mono focus:border-green-500 outline-none appearance-none"
                            >
                                <option value={0}>Continuous (Real-Time)</option>
                                <option value={5}>5 Seconds (Quick)</option>
                                <option value={15}>15 Seconds (Standard)</option>
                                <option value={30}>30 Seconds (Precise)</option>
                                <option value={60}>60 Seconds (High Res)</option>
                                <option value={180}>3 Minutes (Expert)</option>
                            </select>
                            <Clock className="absolute right-2 top-2 text-slate-500 pointer-events-none" size={12} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                         <div>
                            <label className="block text-[10px] text-slate-500 mb-1 uppercase font-bold">Wavelength</label>
                            <div className="flex flex-col gap-1">
                                <button 
                                    onClick={() => setConfig({...config, wavelength: 1310})}
                                    className={`text-xs py-1 rounded border ${config.wavelength === 1310 ? 'bg-green-900/40 text-green-400 border-green-500' : 'bg-slate-950 border-slate-700 text-slate-500'}`}
                                >1310 nm</button>
                                <button 
                                    onClick={() => setConfig({...config, wavelength: 1550})}
                                    className={`text-xs py-1 rounded border ${config.wavelength === 1550 ? 'bg-green-900/40 text-green-400 border-green-500' : 'bg-slate-950 border-slate-700 text-slate-500'}`}
                                >1550 nm</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* EVENTS PANEL */}
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 shadow-xl flex-1 flex flex-col">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Zap size={12} /> Events
                </h3>
                
                <div className="grid grid-cols-4 gap-2 mb-4">
                    <button onClick={() => handleAddEvent('connector')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded p-2 flex flex-col items-center gap-1 text-[10px]">
                        <EventIconHTML type="connector" className="text-blue-400" />
                        <span className="text-slate-300">Conn</span>
                    </button>
                    <button onClick={() => handleAddEvent('splice')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded p-2 flex flex-col items-center gap-1 text-[10px]">
                        <EventIconHTML type="splice" className="text-yellow-400" />
                        <span className="text-slate-300">Splice</span>
                    </button>
                    <button onClick={() => handleAddEvent('bend')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded p-2 flex flex-col items-center gap-1 text-[10px]">
                        <EventIconHTML type="bend" className="text-orange-400" />
                        <span className="text-slate-300">Bend</span>
                    </button>
                    <button onClick={() => handleAddEvent('degradation')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded p-2 flex flex-col items-center gap-1 text-[10px]">
                        <EventIconHTML type="degradation" className="text-red-400" />
                        <span className="text-slate-300">Stress</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px] pr-1">
                    {events.map((e) => {
                         let color = 'text-slate-400';
                         if (e.type === 'connector') color = 'text-blue-400';
                         if (e.type === 'splice') color = 'text-yellow-400';
                         if (e.type === 'bend') color = 'text-orange-400';
                         if (e.type === 'degradation') color = 'text-red-400';
                         if (e.type === 'cut') color = 'text-red-500';
                         if (e.type === 'start' || e.type === 'end') color = 'text-green-500';

                         return (
                        <div key={e.id} className="bg-slate-950 p-2 rounded border border-slate-800 text-xs hover:border-slate-600 transition-colors group">
                            <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center gap-2">
                                    <EventIconHTML type={e.type} className={color} />
                                    <span className={`font-bold uppercase ${color}`}>{e.type}</span>
                                </div>
                                {e.type !== 'start' && e.type !== 'end' && (
                                    <button onClick={() => handleDeleteEvent(e.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                    <label className="text-[9px] text-slate-600 uppercase">Dist (km)</label>
                                    <input 
                                        type="number" step="0.001"
                                        value={e.distance}
                                        onChange={(ev) => handleUpdateEvent(e.id, 'distance', parseFloat(ev.target.value))}
                                        className="w-full bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-slate-300 font-mono text-[10px]"
                                        disabled={e.type === 'start'}
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] text-slate-600 uppercase">Loss (dB)</label>
                                    <input 
                                        type="number" step="0.01"
                                        value={e.loss}
                                        onChange={(ev) => handleUpdateEvent(e.id, 'loss', parseFloat(ev.target.value))}
                                        className="w-full bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-slate-300 font-mono text-[10px]"
                                    />
                                </div>
                            </div>
                        </div>
                    )})}
                </div>
            </div>

        </div>

        {/* RIGHT COLUMN: Visualization */}
        <div className="lg:col-span-9 flex flex-col gap-4">

            {/* TOPOLOGY STRIP WITH DEVICE */}
            <div className="flex gap-2">
                {/* OTDR Device Visualization */}
                <div className="w-32 bg-slate-900 rounded-lg border border-slate-700 p-2 flex flex-col items-center justify-between relative shadow-lg">
                    <div className="w-full h-8 bg-black rounded border border-slate-600 relative overflow-hidden flex items-center justify-center">
                         {isSimulating && (
                            <div className="absolute inset-0 bg-green-500/20 animate-pulse"></div>
                         )}
                         <span className="text-[9px] font-mono text-green-400 z-10">{isSimulating ? 'LASER ON' : 'READY'}</span>
                    </div>
                    <div className="flex flex-col items-center">
                        <Server size={24} className="text-slate-500 mb-1" />
                        <span className="text-[9px] font-bold text-slate-400">OTDR UNIT</span>
                    </div>
                    {/* Signal Connection */}
                    <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 z-20">
                         <div className={`w-3 h-3 rounded-full border-2 ${isSimulating ? 'bg-red-500 border-red-300 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-slate-800 border-slate-600'}`}></div>
                    </div>
                </div>

                {/* Fiber View */}
                <div className="flex-1 bg-slate-900 rounded-lg p-2 border border-slate-700 relative overflow-hidden h-[84px]">
                    <div className="absolute inset-x-8 top-1/2 h-0.5 bg-slate-700 -translate-y-1/2 flex items-center">
                        {/* Active Path */}
                        <div className="h-full bg-blue-500/50 absolute left-0" style={{ width: `${(visualizationEvents[visualizationEvents.length-1]?.distance || config.range) / config.range * 100}%`}}></div>
                        
                        {/* Realistic Signal Animation (Multi-Pulse) */}
                        {signals.map(s => (
                             <div 
                                key={s.id}
                                className={`absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full blur-sm pointer-events-none transition-transform will-change-transform ${s.type === 'pulse' ? 'bg-red-500/40' : 'bg-blue-400/30'}`}
                                style={{ 
                                    left: `${s.x}%`, 
                                    opacity: s.opacity,
                                    transform: `translate(-50%, -50%) scale(${s.type === 'pulse' ? 1 : 1.2})` 
                                }}
                            >
                                <div className={`absolute inset-2 rounded-full blur-[2px] ${s.type === 'pulse' ? 'bg-red-400' : 'bg-blue-300'}`}></div>
                            </div>
                        ))}

                        {/* Events */}
                        {visualizationEvents.map((e) => {
                            const pos = (e.distance / config.range) * 100;
                            if (pos > 100) return null;

                            let color = 'text-slate-400';
                            if (e.type === 'connector') color = 'text-blue-500';
                            if (e.type === 'splice') color = 'text-yellow-500';
                            if (e.type === 'bend') color = 'text-orange-500';
                            if (e.type === 'degradation') color = 'text-red-400';
                            if (e.type === 'end') color = 'text-red-500';
                            if (e.type === 'start') color = 'text-green-500';
                            if (e.type === 'cut') color = 'text-red-600';

                            return (
                                <div 
                                    key={e.id}
                                    className={`absolute top-1/2 -translate-y-1/2 -ml-3 flex flex-col items-center group cursor-pointer hover:z-30 ${e.type === 'cut' ? 'z-20' : 'z-10'}`}
                                    style={{ left: `${pos}%` }}
                                >
                                    <div className={`p-1 bg-slate-800 border border-slate-600 rounded-full shadow-lg hover:scale-125 transition-transform ${color}`}>
                                        <EventIconHTML type={e.type} className="" />
                                    </div>
                                    <div className="absolute top-8 text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 whitespace-nowrap bg-slate-950 px-2 py-1 rounded border border-slate-700 z-50 pointer-events-none shadow-xl">
                                        <span className={`font-bold uppercase ${color}`}>{e.type}</span> @ {e.distance.toFixed(4)}km
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* MAIN GRAPH CONTROLS */}
            <div className="flex justify-between items-center bg-slate-900 p-2 rounded-t-lg border-x border-t border-slate-700">
                <div className="flex items-center gap-2">
                     <button onClick={() => handleZoom('in')} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-slate-300">
                         <ZoomIn size={16} />
                     </button>
                     <button onClick={() => handleZoom('out')} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-slate-300">
                         <ZoomOut size={16} />
                     </button>
                     <button onClick={resetZoom} className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-xs text-slate-300 font-bold">
                         FIT
                     </button>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
                    <span className="flex items-center gap-1">
                        <MoveHorizontal size={12} />
                        VIEW: {viewState.start.toFixed(2)} - {viewState.end.toFixed(2)} KM
                    </span>
                    {sampleCount > 0 && (
                        <span className="text-green-500 font-bold">Avgs: {sampleCount}</span>
                    )}
                </div>
            </div>

            {/* MAIN GRAPH */}
            <div className="bg-black rounded-b-lg border border-slate-600 shadow-2xl overflow-hidden flex flex-col relative h-[400px]">
                {/* Overlay Stats */}
                <div className="absolute top-4 right-4 text-right pointer-events-none z-20 bg-black/50 p-2 rounded backdrop-blur-sm border border-slate-800">
                    <div className="text-3xl font-mono font-bold text-green-500 tabular-nums">{cursor ? cursor.y.toFixed(3) : '--.---'} <span className="text-sm text-green-700">dB</span></div>
                    <div className="text-lg font-mono text-green-400 tabular-nums">{cursor ? cursor.x.toFixed(5) : '--.-----'} <span className="text-xs text-green-700">km</span></div>
                </div>
                
                <div className="absolute top-4 left-4 z-20 flex gap-2">
                     <div className="text-[10px] text-slate-500 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
                         RES: {((viewRange / 4000) * 1000).toFixed(1)}m / pt
                     </div>
                </div>

                {/* SVG Area */}
                <div className="flex-1 w-full h-full relative cursor-crosshair group" >
                    <svg 
                        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} 
                        className="w-full h-full block" 
                        preserveAspectRatio="none"
                        onMouseMove={handleChartMouseMove}
                        onMouseLeave={() => setCursor(null)}
                    >
                        {/* Defined Grid */}
                        <defs>
                            <pattern id="gridLarge" width="100" height="50" patternUnits="userSpaceOnUse">
                                <path d="M 100 0 L 0 0 0 50" fill="none" stroke="#1e293b" strokeWidth="1"/>
                            </pattern>
                            <pattern id="gridSmall" width="20" height="10" patternUnits="userSpaceOnUse">
                                <path d="M 20 0 L 0 0 0 10" fill="none" stroke="#0f172a" strokeWidth="0.5"/>
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#gridSmall)" />
                        <rect width="100%" height="100%" fill="url(#gridLarge)" />
                        
                        {/* Noise Floor Line */}
                        <line x1="0" y1={GRAPH_HEIGHT - (config.noiseFloor - MIN_DB)*yScale} x2={GRAPH_WIDTH} y2={GRAPH_HEIGHT - (config.noiseFloor - MIN_DB)*yScale} stroke="#334155" strokeDasharray="5,5" />

                        {/* Trace Data */}
                        <path 
                            d={getChartPath()} 
                            className="otdr-trace" 
                            vectorEffect="non-scaling-stroke"
                        />
                        
                        {/* Event Vertical Markers (Filtered by view) */}
                        {visualizationEvents.map((e) => {
                             if (e.distance < viewState.start || e.distance > viewState.end) return null;

                             const x = kmToPx(e.distance);
                             
                             let color = '#64748b'; 
                             if (e.type === 'connector') color = '#3b82f6'; 
                             if (e.type === 'splice') color = '#eab308'; 
                             if (e.type === 'bend') color = '#f97316'; 
                             if (e.type === 'degradation') color = '#ef4444'; 
                             if (e.type === 'cut') color = '#dc2626'; 
                             if (e.type === 'end') color = '#ef4444'; 
                             if (e.type === 'start') color = '#22c55e'; 

                             // Find Y for marker placement
                             const step = config.range / 4000;
                             const idx = Math.floor(e.distance / step);
                             const point = traceData[Math.min(idx, traceData.length-1)];
                             let y = point ? GRAPH_HEIGHT - (point.y - MIN_DB) * yScale : GRAPH_HEIGHT/2;
                             const markerY = Math.max(30, y - 30);

                             return (
                                <g key={'graph-'+e.id} className="pointer-events-none">
                                    <line x1={x} y1={markerY + 12} x2={x} y2={y} stroke={color} strokeWidth="1" strokeDasharray="2,2" opacity="0.6" />
                                    <g transform={`translate(${x}, ${markerY})`}>
                                        <EventIconSVG type={e.type} color={color} size={24} />
                                    </g>
                                    <text x={x} y={markerY - 8} textAnchor="middle" fill={color} fontSize="10" fontWeight="bold" opacity="0.8">{e.distance.toFixed(3)}</text>
                                </g>
                             )
                        })}

                        {/* Cursor Crosshair */}
                        {cursor && (
                            <>
                                <line 
                                    x1={kmToPx(cursor.x)} y1="0" 
                                    x2={kmToPx(cursor.x)} y2={GRAPH_HEIGHT} 
                                    stroke="#4ade80" strokeWidth="0.5" strokeDasharray="5,2" opacity="0.8"
                                />
                                <line 
                                    x1="0" y1={GRAPH_HEIGHT - (cursor.y - MIN_DB) * yScale} 
                                    x2={GRAPH_WIDTH} y2={GRAPH_HEIGHT - (cursor.y - MIN_DB) * yScale} 
                                    stroke="#4ade80" strokeWidth="0.5" strokeDasharray="5,2" opacity="0.8"
                                />
                            </>
                        )}
                    </svg>

                    {/* Axis Labels */}
                    <div className="absolute bottom-0 left-0 right-0 h-6 flex justify-between px-2 text-[10px] text-slate-500 font-mono pointer-events-none select-none">
                        <span>{viewState.start.toFixed(2)} km</span>
                        <span>{(viewState.start + viewRange * 0.25).toFixed(2)}</span>
                        <span>{(viewState.start + viewRange * 0.5).toFixed(2)}</span>
                        <span>{(viewState.start + viewRange * 0.75).toFixed(2)}</span>
                        <span>{viewState.end.toFixed(2)} km</span>
                    </div>
                    <div className="absolute top-0 bottom-6 left-0 w-8 flex flex-col justify-between py-2 text-[10px] text-slate-500 font-mono items-start pl-1 pointer-events-none select-none">
                        <span>{MAX_DB}dB</span>
                        <span>0dB</span>
                        <span>{config.noiseFloor}dB</span>
                    </div>
                </div>
            </div>

            {/* Scroll Bar Control */}
            {viewRange < config.range && (
                <div className="flex items-center gap-2 px-2">
                    <input 
                        type="range" 
                        min="0" max="1" step="0.001"
                        value={(viewState.start + viewRange/2) / config.range}
                        onChange={handleScroll}
                        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-green-500"
                    />
                </div>
            )}

            {/* ANALYSIS TABLE */}
            <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden shadow-lg">
                <div className="bg-slate-800 px-4 py-2 flex justify-between items-center border-b border-slate-700">
                    <h3 className="text-xs font-bold text-slate-200 uppercase tracking-widest flex items-center gap-2">
                        <MousePointer2 size={12} /> Event Analysis
                    </h3>
                    <div className="text-[10px] text-slate-400 font-mono">
                        SOR Emulation | 2-Point Loss
                    </div>
                </div>
                <div className="overflow-x-auto max-h-[150px]">
                    <table className="w-full text-xs text-left whitespace-nowrap">
                        <thead className="bg-slate-950 text-slate-500 uppercase font-bold text-[10px] sticky top-0 z-10">
                            <tr>
                                <th className="px-4 py-3 bg-slate-950">No.</th>
                                <th className="px-4 py-3 bg-slate-950">Event Type</th>
                                <th className="px-4 py-3 bg-slate-950">Loc (km)</th>
                                <th className="px-4 py-3 bg-slate-950">Loss (dB)</th>
                                <th className="px-4 py-3 bg-slate-950">Refl. (dB)</th>
                                <th className="px-4 py-3 bg-slate-950">Cumul. (dB)</th>
                                <th className="px-4 py-3 bg-slate-950">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 font-mono text-slate-300">
                            {detectedEvents.map((e, i) => {
                                const isHighLoss = parseFloat(e.loss) > 0.8 && e.type !== 'cut';
                                return (
                                <tr key={i} className="hover:bg-slate-800/50 transition-colors">
                                    <td className="px-4 py-2 text-slate-500">{e.no + 1}</td>
                                    <td className="px-4 py-2 flex items-center gap-2">
                                        <EventIconHTML type={e.type} className={
                                            e.type === 'connector' ? 'text-blue-400' : 
                                            e.type === 'splice' ? 'text-yellow-400' :
                                            e.type === 'bend' ? 'text-orange-400' :
                                            e.type === 'degradation' ? 'text-red-400' :
                                            e.type === 'cut' ? 'text-red-500' : 'text-slate-400'
                                        } />
                                        <span className="font-sans font-bold text-[10px] text-slate-400">{e.type.toUpperCase()}</span>
                                    </td>
                                    <td className="px-4 py-2 text-blue-300">{e.location}</td>
                                    <td className={`px-4 py-2 ${isHighLoss ? 'text-red-400 font-bold' : ''}`}>{e.loss}</td>
                                    <td className="px-4 py-2">{e.reflectance}</td>
                                    <td className="px-4 py-2 text-slate-400">{e.cumLoss}</td>
                                    <td className="px-4 py-2">
                                        {e.type === 'cut' ? <span className="text-red-500 font-bold text-[10px]">END OF FIBER</span> : 
                                         isHighLoss ? <span className="text-yellow-500 text-[10px]">WARN</span> : 
                                         <span className="text-green-500 text-[10px]">PASS</span>}
                                    </td>
                                </tr>
                            )})}
                            {detectedEvents.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-slate-600 italic">
                                        Trace analysis pending or no events detected.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* CALCULATIONS & PHYSICS PANEL */}
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 shadow-xl">
                 <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Calculator size={12} /> Physics & Calculations
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <PhysicsCard 
                        title="Pulse Length" 
                        value={pulseLengthM.toFixed(1)} 
                        unit="m" 
                        icon={TrendingDown}
                        subtext="Physical length of light pulse"
                        formula="L = v × t"
                    />
                    <PhysicsCard 
                        title="Event Dead Zone" 
                        value={eventDeadZoneM.toFixed(1)} 
                        unit="m" 
                        icon={ZapOff}
                        subtext="Min dist. to detect next event"
                        formula="~ 1.5 × L"
                    />
                    <PhysicsCard 
                        title="Attenuation Dead Zone" 
                        value={attenDeadZoneM.toFixed(1)} 
                        unit="m" 
                        icon={Waves}
                        subtext="Min dist. to measure loss"
                        formula="~ 4.0 × L"
                    />
                    <PhysicsCard 
                        title="Sampling Res." 
                        value={samplingResM.toFixed(2)} 
                        unit="m" 
                        icon={Ruler}
                        subtext="Digital sampling interval"
                        formula="Range / Points"
                    />
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
