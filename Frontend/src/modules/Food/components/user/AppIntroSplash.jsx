import { useState, useEffect, useRef } from "react";
import api from "@food/api";
import { Loader2 } from "lucide-react";
import { getMediaUrl } from "@/shared/utils/media";

const safeGetIntroSeen = () => {
  try { return sessionStorage.getItem("appIntroSeen"); } catch (e) { return null; }
};
const safeSetIntroSeen = () => {
  try { sessionStorage.setItem("appIntroSeen", "true"); } catch (e) {}
};

export default function AppIntroSplash({ onComplete }) {
  const [screens, setScreens] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // Check if already seen in this session
    if (safeGetIntroSeen()) {
      onComplete();
      return;
    }
    
    const fetchScreens = async () => {
      try {
        const res = await api.get('/food/app-intro-ads/public');
        if (res.data?.success && res.data.data.length > 0) {
          setScreens(res.data.data);
        } else {
          safeSetIntroSeen();
          onComplete();
        }
      } catch (err) {
        console.error("Failed to fetch intro screens", err);
        safeSetIntroSeen();
        onComplete();
      } finally {
        setLoading(false);
      }
    };
    fetchScreens();
  }, [onComplete]);

  useEffect(() => {
    if (screens.length > 0 && currentIndex < screens.length) {
      const duration = (screens[currentIndex].duration || 3) * 1000;
      const timer = setTimeout(() => {
        if (currentIndex < screens.length - 1) {
          setCurrentIndex(prev => prev + 1);
        } else {
          safeSetIntroSeen();
          onComplete();
        }
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [currentIndex, screens, onComplete]);

  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(e => console.log("Video auto-play prevented:", e));
    }
  }, [currentIndex]);

  if (safeGetIntroSeen()) return null;
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }
  if (screens.length === 0) return null;

  const currentScreen = screens[currentIndex];


  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center overflow-hidden animate-in fade-in duration-300">
      {currentScreen.mediaType === 'video' ? (
        <video 
          ref={videoRef}
          key={currentScreen._id}
          src={getMediaUrl(currentScreen.mediaUrl)} 
          className="w-full h-full object-contain" 
          autoPlay 
          muted 
          playsInline 
          loop 
        />
      ) : (
        <img 
          key={currentScreen._id}
          src={getMediaUrl(currentScreen.mediaUrl)} 
          alt={currentScreen.title || "Intro"} 
          className="w-full h-full object-contain"
        />
      )}
      
      <button 
        onClick={() => {
          safeSetIntroSeen();
          onComplete();
        }}
        className="absolute top-6 right-6 px-4 py-2 bg-black/40 text-white rounded-full text-sm font-medium backdrop-blur-sm z-50 hover:bg-black/60 transition-colors"
      >
        Skip
      </button>
      
      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-2 z-50">
        {screens.map((_, idx) => (
          <div 
            key={idx} 
            className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/50'}`}
          />
        ))}
      </div>
    </div>
  );
}


