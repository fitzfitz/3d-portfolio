import { Mail, ArrowUp } from "lucide-react";

export default function Footer() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer className="w-full py-12 border-t border-white/5 relative bg-background">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Info / Copyright */}
        <div className="flex flex-col items-center md:items-start gap-2">
          <p className="font-mono text-xs text-muted">
            Designed & Engineered by Fitzgeral &copy; {new Date().getFullYear()}
          </p>
          <p className="text-[10px] font-mono text-white/20">
            Powered by React, Vite, Three.js & Tailwind CSS
          </p>
        </div>

        {/* Social Links */}
        <div className="flex items-center gap-6">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-lg border border-white/5 flex items-center justify-center text-muted hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all duration-300"
            aria-label="GitHub Profile"
          >
            <svg
              className="w-5 h-5 fill-current"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
          </a>
          <a
            href="https://linkedin.com"
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-lg border border-white/5 flex items-center justify-center text-muted hover:text-secondary hover:border-secondary/30 hover:bg-secondary/5 transition-all duration-300"
            aria-label="LinkedIn Profile"
          >
            <svg
              className="w-5 h-5 fill-current"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.779-1.75-1.75s.784-1.75 1.75-1.75 1.75.779 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
            </svg>
          </a>
          <a
            href="mailto:hello@example.com"
            className="w-10 h-10 rounded-lg border border-white/5 flex items-center justify-center text-muted hover:text-accent hover:border-accent/30 hover:bg-accent/5 transition-all duration-300"
            aria-label="Send Email"
          >
            <Mail className="w-5 h-5" />
          </a>
        </div>

        {/* Back to Top */}
        <button
          onClick={scrollToTop}
          className="w-10 h-10 rounded-lg border border-white/5 flex items-center justify-center text-muted hover:text-primary hover:border-primary/30 hover:bg-primary/5 cursor-pointer transition-all duration-300"
          aria-label="Scroll to top"
        >
          <ArrowUp className="w-5 h-5 animate-pulse" />
        </button>
      </div>
    </footer>
  );
}
