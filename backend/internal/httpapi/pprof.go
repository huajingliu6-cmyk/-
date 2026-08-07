package httpapi

import (
	"net/http"
	"net/http/pprof"
)

func PprofHandler(internalToken string) http.Handler {
	mux := http.NewServeMux()
	if internalToken != "" {
		mux.Handle("/", authPprof(internalToken, pprofIndex()))
		mux.Handle("/cmdline", authPprof(internalToken, http.HandlerFunc(pprof.Cmdline)))
		mux.Handle("/profile", authPprof(internalToken, http.HandlerFunc(pprof.Profile)))
		mux.Handle("/symbol", authPprof(internalToken, http.HandlerFunc(pprof.Symbol)))
		mux.Handle("/trace", authPprof(internalToken, http.HandlerFunc(pprof.Trace)))
		mux.Handle("/allocs", authPprof(internalToken, pprof.Handler("allocs")))
		mux.Handle("/block", authPprof(internalToken, pprof.Handler("block")))
		mux.Handle("/goroutine", authPprof(internalToken, pprof.Handler("goroutine")))
		mux.Handle("/heap", authPprof(internalToken, pprof.Handler("heap")))
		mux.Handle("/mutex", authPprof(internalToken, pprof.Handler("mutex")))
		mux.Handle("/threadcreate", authPprof(internalToken, pprof.Handler("threadcreate")))
		return mux
	}
	mux.HandleFunc("/", pprof.Index)
	mux.HandleFunc("/cmdline", pprof.Cmdline)
	mux.HandleFunc("/profile", pprof.Profile)
	mux.HandleFunc("/symbol", pprof.Symbol)
	mux.HandleFunc("/trace", pprof.Trace)
	mux.Handle("/allocs", pprof.Handler("allocs"))
	mux.Handle("/block", pprof.Handler("block"))
	mux.Handle("/goroutine", pprof.Handler("goroutine"))
	mux.Handle("/heap", pprof.Handler("heap"))
	mux.Handle("/mutex", pprof.Handler("mutex"))
	mux.Handle("/threadcreate", pprof.Handler("threadcreate"))
	return mux
}

func pprofIndex() http.Handler {
	return http.HandlerFunc(pprof.Index)
}

func authPprof(internalToken string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !validToken(request.Header.Get("X-Internal-Token"), internalToken) {
			writeError(writer, http.StatusUnauthorized, "invalid internal token")
			return
		}
		next.ServeHTTP(writer, request)
	})
}
