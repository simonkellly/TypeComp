"""
OR-Tools CP-SAT solver for wave assignment optimization.
Takes JSON model as input and returns JSON solution.
"""

import json
import sys
from ortools.sat.python import cp_model


def solve_wave_assignment(model_json):
    """Solve wave assignment using OR-Tools CP-SAT."""
    model_data = json.loads(model_json)
    
    
    variables = model_data['variables']
    constraints = model_data['constraints']
    integers = model_data['integers']
    optimize = model_data.get('optimize', 'events')
    
    
    cp_model_instance = cp_model.CpModel()
    
    
    cp_vars = {}
    for var_name in variables:
        if var_name in integers:
            
            cp_vars[var_name] = cp_model_instance.NewBoolVar(var_name)
        else:
            
            cp_vars[var_name] = cp_model_instance.NewIntVar(0, 1, var_name)
    
    
    for constraint_name, constraint_def in constraints.items():
        if 'equal' in constraint_def:
            
            value = constraint_def['equal']
            terms = []
            for var_name, var_coeffs in variables.items():
                if constraint_name in var_coeffs:
                    coeff = var_coeffs[constraint_name]
                    terms.append(cp_vars[var_name] * coeff)
            cp_model_instance.Add(sum(terms) == value)
            
        elif 'min' in constraint_def:
            
            value = constraint_def['min']
            terms = []
            for var_name, var_coeffs in variables.items():
                if constraint_name in var_coeffs:
                    coeff = var_coeffs[constraint_name]
                    terms.append(cp_vars[var_name] * coeff)
            cp_model_instance.Add(sum(terms) >= value)
            
        elif 'max' in constraint_def:
            
            value = constraint_def['max']
            terms = []
            for var_name, var_coeffs in variables.items():
                if constraint_name in var_coeffs:
                    coeff = var_coeffs[constraint_name]
                    terms.append(cp_vars[var_name] * coeff)
            cp_model_instance.Add(sum(terms) <= value)
    
    
    objective_terms = []
    for var_name, var_coeffs in variables.items():
        if optimize in var_coeffs:
            coeff = var_coeffs[optimize]
            objective_terms.append(cp_vars[var_name] * coeff)
    
    cp_model_instance.Minimize(sum(objective_terms))
    
    
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 300.0  
    
    status = solver.Solve(cp_model_instance)
    
    
    solution = {}
    
    if status == cp_model.OPTIMAL:
        solution['feasible'] = True
        solution['status'] = 'optimal'
        solution['result'] = solver.ObjectiveValue()
        
        
        for var_name, cp_var in cp_vars.items():
            solution[var_name] = int(solver.Value(cp_var))
            
    elif status == cp_model.FEASIBLE:
        solution['feasible'] = True
        solution['status'] = 'feasible'
        solution['result'] = solver.ObjectiveValue()
        
        for var_name, cp_var in cp_vars.items():
            solution[var_name] = int(solver.Value(cp_var))
            
    elif status == cp_model.INFEASIBLE:
        solution['feasible'] = False
        solution['status'] = 'infeasible'
        solution['result'] = None
        
    elif status == cp_model.MODEL_INVALID:
        solution['feasible'] = False
        solution['status'] = 'model_invalid'
        solution['result'] = None
        
    else:
        solution['feasible'] = False
        solution['status'] = 'unknown'
        solution['result'] = None
    
    return solution


if __name__ == '__main__':
    
    input_json = sys.stdin.read()
    
    try:
        solution = solve_wave_assignment(input_json)
        print(json.dumps(solution))
    except Exception as e:
        error_result = {
            'feasible': False,
            'status': 'error',
            'error': str(e),
            'result': None
        }
        print(json.dumps(error_result))
        sys.exit(1)

