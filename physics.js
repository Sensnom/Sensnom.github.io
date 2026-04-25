(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }

    root.QuantumPhysics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function buildPotential({ N, xMin, dx, barrierCenter, d, V0 }) {
        const potential = new Float64Array(N);

        for (let i = 0; i < N; i++) {
            const x = xMin + i * dx;
            potential[i] = x >= barrierCenter - d / 2 && x <= barrierCenter + d / 2 ? V0 : 0;
        }

        return potential;
    }

    function calculateRectBarrierTR({ E, V0, d, mass, hbar }) {
        if (Math.abs(E - V0) < 1e-6) {
            const term = (mass * V0 * d * d) / (2 * hbar * hbar);
            const T = 1 / (1 + term);
            return { T, R: 1 - T };
        }

        if (E < V0) {
            const kappa = Math.sqrt(2 * mass * (V0 - E)) / hbar;
            const sinhKd = Math.sinh(kappa * d);
            const term = (V0 * V0 * sinhKd * sinhKd) / (4 * E * (V0 - E));
            const T = 1 / (1 + term);
            return { T, R: 1 - T };
        }

        const k2 = Math.sqrt(2 * mass * (E - V0)) / hbar;
        const sinKd = Math.sin(k2 * d);
        const term = (V0 * V0) / (4 * E * (E - V0));
        const T = 1 / (1 + term * sinKd * sinKd);
        return { T, R: 1 - T };
    }

    function cDiv(aRe, aIm, bRe, bIm) {
        const denom = bRe * bRe + bIm * bIm;
        return {
            re: (aRe * bRe + aIm * bIm) / denom,
            im: (aIm * bRe - aRe * bIm) / denom
        };
    }

    function createGaussianPacket({ N, xMin, dx, x0, k0, sigma }) {
        const psiRe = new Float64Array(N);
        const psiIm = new Float64Array(N);

        for (let i = 0; i < N; i++) {
            const x = xMin + i * dx;
            const env = Math.exp(-Math.pow((x - x0) / sigma, 2) / 2.0);
            const phase = k0 * (x - x0);
            psiRe[i] = env * Math.cos(phase);
            psiIm[i] = env * Math.sin(phase);
        }

        return { psiRe, psiIm };
    }

    function stepCrankNicolson({ psiRe, psiIm, V, dt, dx, mass, hbar, work, absorption, dampCoefs }) {
        const N = psiRe.length;
        const { cRe, cIm, dRe, dIm } = work;
        const rx = hbar / (4 * mass * dx * dx);
        const bRe = new Float64Array(N);
        const bIm = new Float64Array(N);

        for (let i = 1; i < N - 1; i++) {
            const kECoef = -hbar / (2 * mass * dx * dx);
            const HpsiRe = kECoef * (psiRe[i - 1] - 2 * psiRe[i] + psiRe[i + 1]) + (V[i] / hbar) * psiRe[i];
            const HpsiIm = kECoef * (psiIm[i - 1] - 2 * psiIm[i] + psiIm[i + 1]) + (V[i] / hbar) * psiIm[i];

            bRe[i] = psiRe[i] + (dt / 2) * HpsiIm;
            bIm[i] = psiIm[i] - (dt / 2) * HpsiRe;
        }

        bRe[0] = 0;
        bIm[0] = 0;
        bRe[N - 1] = 0;
        bIm[N - 1] = 0;

        const rxDt = rx * dt;
        cRe[0] = 0;
        cIm[0] = 0;
        dRe[0] = 0;
        dIm[0] = 0;

        for (let i = 1; i < N - 1; i++) {
            const DRe = 1.0;
            const DIm = (dt / 2) * (hbar / (mass * dx * dx) + V[i] / hbar);
            const URe = 0;
            const UIm = -rxDt;
            const LRe = 0;
            const LIm = -rxDt;

            const LcRe = LRe * cRe[i - 1] - LIm * cIm[i - 1];
            const LcIm = LRe * cIm[i - 1] + LIm * cRe[i - 1];
            const denomRe = DRe - LcRe;
            const denomIm = DIm - LcIm;
            const cRes = cDiv(URe, UIm, denomRe, denomIm);
            cRe[i] = cRes.re;
            cIm[i] = cRes.im;

            const LdRe = LRe * dRe[i - 1] - LIm * dIm[i - 1];
            const LdIm = LRe * dIm[i - 1] + LIm * dRe[i - 1];
            const numRe = bRe[i] - LdRe;
            const numIm = bIm[i] - LdIm;
            const dRes = cDiv(numRe, numIm, denomRe, denomIm);
            dRe[i] = dRes.re;
            dIm[i] = dRes.im;
        }

        psiRe[N - 1] = 0;
        psiIm[N - 1] = 0;
        for (let i = N - 2; i >= 1; i--) {
            const cpsiRe = cRe[i] * psiRe[i + 1] - cIm[i] * psiIm[i + 1];
            const cpsiIm = cRe[i] * psiIm[i + 1] + cIm[i] * psiRe[i + 1];
            psiRe[i] = dRe[i] - cpsiRe;
            psiIm[i] = dIm[i] - cpsiIm;
        }
        psiRe[0] = 0;
        psiIm[0] = 0;

        for (let i = 0; i < dampCoefs.length * 10; i++) {
            if (i >= N / 2) break;
            const factor = dampCoefs[Math.floor(i / 10)];
            const probBefore = (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]) * dx;
            psiRe[i] *= factor;
            psiIm[i] *= factor;
            const probAfter = (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]) * dx;
            absorption.left += probBefore - probAfter;
        }

        for (let i = 0; i < dampCoefs.length * 10; i++) {
            if (N - 1 - i <= N / 2) break;
            const factor = dampCoefs[Math.floor(i / 10)];
            const idx = N - 1 - i;
            const probBefore = (psiRe[idx] * psiRe[idx] + psiIm[idx] * psiIm[idx]) * dx;
            psiRe[idx] *= factor;
            psiIm[idx] *= factor;
            const probAfter = (psiRe[idx] * psiRe[idx] + psiIm[idx] * psiIm[idx]) * dx;
            absorption.right += probBefore - probAfter;
        }
    }

    function measureProbabilities({
        psiRe,
        psiIm,
        xMin,
        dx,
        barrierCenter,
        d,
        N_damp,
        absorbedLeft,
        absorbedRight,
        initialTotalProb
    }) {
        let visibleTotal = 0;
        let leftVisible = 0;
        let barrierVisible = 0;
        let rightVisible = 0;
        const bLeft = barrierCenter - d / 2;
        const bRight = barrierCenter + d / 2;

        for (let i = N_damp; i < psiRe.length - N_damp; i++) {
            const x = xMin + i * dx;
            const p = (psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i]) * dx;
            visibleTotal += p;
            if (x < bLeft) leftVisible += p;
            else if (x > bRight) rightVisible += p;
            else barrierVisible += p;
        }

        return {
            visibleTotal,
            leftVisible: leftVisible / initialTotalProb,
            barrierVisible: barrierVisible / initialTotalProb,
            rightVisible: rightVisible / initialTotalProb,
            actualR: (leftVisible + absorbedLeft) / initialTotalProb,
            actualT: (rightVisible + absorbedRight) / initialTotalProb
        };
    }

    return {
        buildPotential,
        calculateRectBarrierTR,
        createGaussianPacket,
        stepCrankNicolson,
        measureProbabilities
    };
});
