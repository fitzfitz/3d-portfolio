import { useState, useEffect } from "react";
import { Menu, X, Cpu } from "lucide-react";

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "Home", href: "#home" },
    { name: "Projects", href: "#projects" },
    { name: "Skills", href: "#skills" },
    { name: "Contact", href: "#contact" },
  ];

  return (
    <nav
      className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${
        isScrolled
          ? "py-4 glass-panel border-b border-white/5"
          : "py-6 bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Brand Logo */}
        <a
          href="#home"
          className="flex items-center gap-2.5 font-display font-bold text-lg text-white tracking-widest group"
        >
          <div className="relative w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-primary/50 transition-colors">
            <Cpu className="w-4.5 h-4.5 text-primary group-hover:rotate-45 transition-transform duration-300" />
            <div className="absolute inset-0 rounded-lg bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity blur" />
          </div>
          <span>
            DEV<span className="text-primary font-light">.SYS</span>
          </span>
        </a>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              className="text-sm font-mono text-muted hover:text-primary tracking-wide transition-colors relative group py-1"
            >
              {link.name}
              <span className="absolute bottom-0 left-0 w-0 h-[2px] bg-primary transition-all duration-300 group-hover:w-full" />
            </a>
          ))}
          <a
            href="#contact"
            className="px-4 py-2 rounded-lg font-mono text-xs text-primary border border-primary/30 bg-primary/5 hover:bg-primary/20 hover:border-primary transition-all duration-300"
          >
            GET_IN_TOUCH
          </a>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 text-muted hover:text-white"
          aria-label="Toggle Navigation Menu"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Navigation Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 w-full glass-panel border-b border-white/5 py-6 px-6 flex flex-col gap-4 animate-fade-in">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className="text-sm font-mono text-muted hover:text-primary tracking-wide py-2"
            >
              &gt; {link.name}
            </a>
          ))}
          <a
            href="#contact"
            onClick={() => setMobileMenuOpen(false)}
            className="mt-2 text-center py-2.5 rounded-lg font-mono text-sm text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
          >
            GET_IN_TOUCH
          </a>
        </div>
      )}
    </nav>
  );
}
