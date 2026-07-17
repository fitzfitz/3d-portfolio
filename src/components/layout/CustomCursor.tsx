import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export default function CustomCursor() {
  const [hovered, setHovered] = useState(false);
  const [cursorText, setCursorText] = useState("");
  const [isVisible, setIsVisible] = useState(false);

  // Motion values for hardware acceleration
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  // Spring configuration for buttery lag effect
  const springConfig = { damping: 30, stiffness: 250, mass: 0.5 };
  const cursorXSpring = useSpring(cursorX, springConfig);
  const cursorYSpring = useSpring(cursorY, springConfig);

  useEffect(() => {
    const moveCursor = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      if (!isVisible) setIsVisible(true);
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
    };

    const handleMouseEnter = () => {
      setIsVisible(true);
    };

    window.addEventListener("mousemove", moveCursor);
    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mouseenter", handleMouseEnter);

    // Event delegation to check if mouse is hovering over interactive elements
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Check if target or parent is interactive
      const isInteractive =
        target.tagName === "A" ||
        target.tagName === "BUTTON" ||
        target.closest("a") ||
        target.closest("button") ||
        target.closest(".glass-card") ||
        target.classList.contains("clickable") ||
        target.getAttribute("role") === "button";

      if (isInteractive) {
        setHovered(true);
        const text = target.getAttribute("data-cursor-text") || "";
        setCursorText(text);
      } else {
        setHovered(false);
        setCursorText("");
      }
    };

    window.addEventListener("mouseover", handleMouseOver);

    return () => {
      window.removeEventListener("mousemove", moveCursor);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mouseenter", handleMouseEnter);
      window.removeEventListener("mouseover", handleMouseOver);
    };
  }, [cursorX, cursorY, isVisible]);

  if (!isVisible) return null;

  return (
    <>
      {/* Outer Ring */}
      <motion.div
        className="fixed top-0 left-0 w-8 h-8 rounded-full border border-primary pointer-events-none z-50 mix-blend-screen -translate-x-1/2 -translate-y-1/2"
        style={{
          x: cursorXSpring,
          y: cursorYSpring,
        }}
        animate={{
          scale: hovered ? 1.6 : 1,
          borderColor: hovered ? "#00f0ff" : "#00ff87",
          backgroundColor: hovered ? "rgba(0, 240, 255, 0.05)" : "rgba(0, 0, 0, 0)",
          boxShadow: hovered
            ? "0 0 20px rgba(0, 240, 255, 0.4)"
            : "0 0 8px rgba(0, 255, 135, 0.2)",
        }}
        transition={{ type: "tween", ease: "backOut", duration: 0.2 }}
      />

      {/* Inner Dot */}
      <motion.div
        className="fixed top-0 left-0 w-2 h-2 rounded-full bg-primary pointer-events-none z-50 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center font-mono text-[8px] text-black font-extrabold select-none whitespace-nowrap"
        style={{
          x: cursorX,
          y: cursorY,
        }}
        animate={{
          scale: hovered ? 0.5 : 1,
          backgroundColor: hovered ? "#00f0ff" : "#00ff87",
        }}
        transition={{ type: "tween", duration: 0.15 }}
      >
        {cursorText}
      </motion.div>
    </>
  );
}
